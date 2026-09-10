import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBranchAction, getBranches } from './branch';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 造一个带初始提交的仓库（a.txt 提交为 init） */
function repoWithCommit(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, 'a.txt'), 'v1');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  return repo;
}

/** 当前默认分支短名（git 版本间 init 默认分支不同，动态取） */
function defaultBranch(repo: string): string {
  return execFileSync('git', ['-C', repo, 'symbolic-ref', 'HEAD', '--short'], { encoding: 'utf8' }).trim();
}

describe('branch 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getBranches 组合 mergedIntoHead：当前分支 true，未合并分支 false', async () => {
    const repo = repoWithCommit();
    const base = defaultBranch(repo);
    // 造未合并分支：feature 上多一个提交，切回 base 后 feature 不在 --merged 名单中
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'feature']);
    writeFileSync(join(repo, 'f.txt'), 'f');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'feature']);
    execFileSync('git', ['-C', repo, 'checkout', '-q', base]);

    const list = await getBranches(repo);
    const cur = list.branches.find((b) => b.name === base);
    const feat = list.branches.find((b) => b.name === 'feature');
    expect(cur?.current).toBe(true);
    expect(cur?.mergedIntoHead).toBe(true);
    expect(feat?.remote).toBe(false);
    expect(feat?.mergedIntoHead).toBe(false);
    // recent：reflog checkout 记录（最近优先）——feature → base
    expect(list.recent).toEqual([base, 'feature']);
  });

  // 冒烟 D-20：被 worktree 检出的分支 git 拒绝删除，列表须标记出来供清理入口排除
  it('getBranches 标记 checkedOutInWorktree：worktree 占用的分支为 true，其余不标', async () => {
    const repo = repoWithCommit();
    const base = defaultBranch(repo);
    const wtPath = `${repo}-wt`;
    dirs.push(wtPath);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', wtPath, '-b', 'wt-branch']);

    const list = await getBranches(repo);
    const wt = list.branches.find((b) => b.name === 'wt-branch');
    const cur = list.branches.find((b) => b.name === base);
    // 附加工作树持有的分支：标记为 true（清理入口据此排除，避免「承诺可清理却必然失败」）
    expect(wt?.checkedOutInWorktree).toBe(true);
    expect(wt?.current).toBe(false);
    // 主工作树当前分支同样出现在 git worktree list 中（标记 true），但其 current 为 true，
    // 清理候选本就以 !current 排除，故两者共同保证候选集只含真正可删分支
    expect(cur?.current).toBe(true);
    expect(cur?.mergedIntoHead).toBe(true);
  });

  it('applyBranchAction create→delete force→rename→setUpstream 轮转，返回刷新列表', async () => {    const repo = repoWithCommit();
    const base = defaultBranch(repo);

    // create：刷新列表含新分支
    const afterCreate = await applyBranchAction(repo, { action: 'create', name: 'tmp' });
    expect(afterCreate.branches.some((b) => b.name === 'tmp')).toBe(true);

    // delete force：刷新列表不再含 tmp
    const afterDelete = await applyBranchAction(repo, { action: 'delete', name: 'tmp', force: true });
    expect(afterDelete.branches.some((b) => b.name === 'tmp')).toBe(false);

    // rename：old-name → new-name
    await applyBranchAction(repo, { action: 'create', name: 'old-name' });
    const afterRename = await applyBranchAction(repo, { action: 'rename', oldName: 'old-name', newName: 'new-name' });
    expect(afterRename.branches.some((b) => b.name === 'new-name')).toBe(true);
    expect(afterRename.branches.some((b) => b.name === 'old-name')).toBe(false);

    // setUpstream：本地分支可互为上游（remote 记录为 .）
    const afterUpstream = await applyBranchAction(repo, { action: 'setUpstream', name: 'new-name', upstream: base });
    const entry = afterUpstream.branches.find((b) => b.name === 'new-name');
    expect(entry?.upstream).toBe(base);
  });

  it('applyBranchAction 目标分支不存在 → INVALID_REF', async () => {
    const repo = repoWithCommit();
    await expect(applyBranchAction(repo, { action: 'delete', name: 'nope' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: expect.stringContaining('分支不存在'),
    });
    await expect(applyBranchAction(repo, { action: 'rename', oldName: 'nope', newName: 'x' })).rejects.toMatchObject({
      code: 'INVALID_REF',
    });
    await expect(applyBranchAction(repo, { action: 'setUpstream', name: 'nope', upstream: 'x' })).rejects.toMatchObject({
      code: 'INVALID_REF',
    });
  });
});
