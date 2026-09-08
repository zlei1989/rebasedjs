import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyStashAction, getStashDiff, getStashes, unstashAs } from './stash';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 造一个带初始提交的仓库（a.txt 提交为 init）；贮藏需要 HEAD 提交作基底 */
function repoWithCommit(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, 'a.txt'), 'v1');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  return repo;
}

/** 当前分支短名（git 版本间 init 默认分支不同，动态取） */
function currentBranch(repo: string): string {
  return execFileSync('git', ['-C', repo, 'symbolic-ref', 'HEAD', '--short'], { encoding: 'utf8' }).trim();
}

describe('stash 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getStashes 空仓库 → 空列表', async () => {
    const repo = repoWithCommit();
    expect(await getStashes(repo)).toEqual({ stashes: [] });
  });

  it('save 保存工作区改动 → 列表 1 条且工作区改动被收走', async () => {
    const repo = repoWithCommit();
    writeFileSync(join(repo, 'a.txt'), 'v2');

    const list = await applyStashAction(repo, { action: 'save', message: 's1' });
    expect(list.stashes).toHaveLength(1);
    expect(list.stashes[0].index).toBe(0);
    expect(list.stashes[0].hash).not.toBe('');
    expect(list.stashes[0].message).toContain('s1');
    // 改动被贮藏，工作区回到 v1
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1');
  });

  it('save keepIndex：暂存区保持不动（--keep-index 语义），工作区变更被收走', async () => {
    const repo = repoWithCommit();
    // 工作区 v2 + 暂存 v2（a.txt 已被 add）；再改回 v3 留工作区
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'v3');

    const list = await applyStashAction(repo, { action: 'save', message: 'keep', keepIndex: true });
    expect(list.stashes).toHaveLength(1);
    // --keep-index：工作区回退到暂存区内容（v2），索引仍含 v2
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
    expect(execFileSync('git', ['-C', repo, 'diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim()).toBe('a.txt');
  });

  it('无工作区改动 save → INVALID_QUERY', async () => {
    const repo = repoWithCommit();
    await expect(applyStashAction(repo, { action: 'save' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: expect.stringContaining('没有可贮藏的工作区改动'),
    });
  });

  it('仅未跟踪文件：未 includeUntracked → INVALID_QUERY；includeUntracked → 成功', async () => {
    const repo = repoWithCommit();
    writeFileSync(join(repo, 'new.txt'), 'n');

    await expect(applyStashAction(repo, { action: 'save' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
    });

    const list = await applyStashAction(repo, { action: 'save', includeUntracked: true });
    expect(list.stashes).toHaveLength(1);
  });

  it('越界 apply/pop/drop/branch → INVALID_REF（贮藏不存在：stash@{n}）', async () => {
    const repo = repoWithCommit();
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await applyStashAction(repo, { action: 'save' });

    await expect(applyStashAction(repo, { action: 'apply', index: 1 })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: expect.stringContaining('贮藏不存在：stash@{1}'),
    });
    await expect(applyStashAction(repo, { action: 'pop', index: 1 })).rejects.toMatchObject({ code: 'INVALID_REF' });
    await expect(applyStashAction(repo, { action: 'drop', index: 5 })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: expect.stringContaining('stash@{5}'),
    });
    await expect(applyStashAction(repo, { action: 'branch', index: 1, name: 'x' })).rejects.toMatchObject({
      code: 'INVALID_REF',
    });
  });

  it('save→apply→drop 轮转，返回刷新列表', async () => {
    const repo = repoWithCommit();
    writeFileSync(join(repo, 'a.txt'), 'v2');

    const afterSave = await applyStashAction(repo, { action: 'save', message: 'rot' });
    expect(afterSave.stashes).toHaveLength(1);

    // apply：改动回到工作区，贮藏仍在
    const afterApply = await applyStashAction(repo, { action: 'apply', index: 0 });
    expect(afterApply.stashes).toHaveLength(1);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');

    // 先清掉工作区改动再 drop，列表清空
    execFileSync('git', ['-C', repo, 'checkout', '-q', '--', 'a.txt']);
    const afterDrop = await applyStashAction(repo, { action: 'drop', index: 0 });
    expect(afterDrop.stashes).toHaveLength(0);
  });

  it('branch 动作：贮藏转为新分支，HEAD 切到该分支且贮藏消失', async () => {
    const repo = repoWithCommit();
    const base = currentBranch(repo);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await applyStashAction(repo, { action: 'save', message: 'to-branch' });

    const list = await applyStashAction(repo, { action: 'branch', index: 0, name: 'from-stash' });
    expect(list.stashes).toHaveLength(0);
    expect(currentBranch(repo)).toBe('from-stash');
    // 贮藏改动已应用到新分支工作区
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
    expect(base).not.toBe('from-stash');
  });

  it('unstashAs：检出目标分支 + apply（不 drop），工作区得到改动且贮藏保留', async () => {
    const repo = repoWithCommit();
    // 建第二个分支（目标分支）再回主分支
    execFileSync('git', ['-C', repo, 'branch', 'target-branch']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await applyStashAction(repo, { action: 'save', message: 'unstash-as' });
    const list = await unstashAs(repo, { index: 0, branch: 'target-branch' });

    expect(list.stashes).toHaveLength(1); // apply 不 drop
    expect(currentBranch(repo)).toBe('target-branch');
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
  });

  it('unstashAs 目标分支不存在 → git 报错上抛；索引越界 → INVALID_REF', async () => {
    const repo = repoWithCommit();
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await applyStashAction(repo, { action: 'save', message: 's' });
    await expect(unstashAs(repo, { index: 0, branch: 'no-such-branch' })).rejects.toBeInstanceOf(Error);
    await expect(unstashAs(repo, { index: 5, branch: currentBranch(repo) })).rejects.toMatchObject({ code: 'INVALID_REF' });
  });

  it('getStashDiff：返回 unified 补丁全文（含改动行）与 index；索引越界 → INVALID_REF', async () => {
    const repo = repoWithCommit();
    writeFileSync(join(repo, 'a.txt'), 'v2\nv3\n');
    await applyStashAction(repo, { action: 'save', message: 'patch' });
    const diff = await getStashDiff(repo, 0);
    expect(diff.index).toBe(0);
    expect(diff.patch).toContain('+v3');
    await expect(getStashDiff(repo, 9)).rejects.toMatchObject({ code: 'INVALID_REF' });
  });
});
