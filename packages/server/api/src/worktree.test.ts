/** worktree 服务集成测试（真实 git）；api 层预检/映射裁定见 task-3-brief。 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createWorktree, getWorktrees, pruneWorktrees, removeWorktree } from './worktree';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeBaseCommit(repo: string): string {
  const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return defaultBranch;
}

/** 主仓库旁的副工作树路径（带空格，验证 porcelain 路径不引号） */
function siblingPath(repo: string, suffix: string): string {
  return join(dirname(repo), basename(repo) + suffix);
}

/** 路径等价比较：git 输出 realpath 长形式，mkdtemp 可能返回 8.3 短形式——OS 级归一 */
function samePath(a: string, b: string): boolean {
  return realpathSync.native(a) === realpathSync.native(b);
}

describe('worktree 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getWorktrees 单仓库返回主工作树（branch/head 完整哈希）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const base = makeBaseCommit(repo);
    const headSha = git(repo, ['rev-parse', 'HEAD']);

    const list = await getWorktrees(repo);
    expect(list.worktrees).toHaveLength(1);
    const main = list.worktrees[0];
    expect(samePath(main.path, repo)).toBe(true);
    expect(main.branch).toBe(base);
    expect(main.detached).toBe(false);
    expect(main.head).toBe(headSha);
  });

  it('createWorktree newBranch：返回刷新列表含主+副（branch 名与 head）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt dir');
    dirs.push(wtPath);

    const list = await createWorktree(repo, { path: wtPath, newBranch: 'feat-2' });

    expect(list.worktrees).toHaveLength(2);
    const wt = list.worktrees.find((w) => samePath(w.path, wtPath));
    expect(wt).toBeDefined();
    expect(wt?.branch).toBe('feat-2');
    expect(wt?.detached).toBe(false);
    expect(wt?.head).toBe(git(repo, ['rev-parse', 'refs/heads/feat-2']));
  });

  it('createWorktree branch 挂接既有分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    git(repo, ['branch', 'feat']);
    const wtPath = siblingPath(repo, '-wt attach');
    dirs.push(wtPath);

    const list = await createWorktree(repo, { path: wtPath, branch: 'feat' });

    const wt = list.worktrees.find((w) => samePath(w.path, wtPath));
    expect(wt?.branch).toBe('feat');
  });

  it('createWorktree 预检互斥：branch+newBranch 同给或都缺 → INVALID_QUERY（先于分支存在性）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt excl');

    // 同给：即使分支不存在也先报互斥（裁定预检顺序）
    await expect(createWorktree(repo, { path: wtPath, branch: 'nope', newBranch: 'x' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '需指定分支或新分支（二选一）',
    });
    await expect(createWorktree(repo, { path: wtPath })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '需指定分支或新分支（二选一）',
    });
  });

  it('createWorktree 分支不存在 → INVALID_REF', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await expect(
      createWorktree(repo, { path: siblingPath(repo, '-wt nope'), branch: 'nope' }),
    ).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '分支不存在：nope',
    });
  });

  it('createWorktree 路径无效：非绝对 / 在 repo 内 / 逃逸 → INVALID_QUERY', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const base = makeBaseCommit(repo);
    const cases = [
      join('relative', 'wt'), // 相对路径
      join(repo, 'inside'), // 在仓库目录内
      join(repo, '..', basename(repo), 'inside'), // .. 归一化后落回仓库目录内（防逃逸）
    ];
    for (const p of cases) {
      await expect(createWorktree(repo, { path: p, branch: base })).rejects.toMatchObject({
        code: 'INVALID_QUERY',
        message: `路径无效：${p}`,
      });
    }
  });

  it('removeWorktree path 等于主仓库 → INVALID_QUERY', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await expect(removeWorktree(repo, { path: repo })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '不能移除当前工作树',
    });
  });

  it('removeWorktree 不在列表（不存在/逃逸路径）→ 直接 INVALID_QUERY 不调 core', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    const missing = siblingPath(repo, '-never');
    await expect(removeWorktree(repo, { path: missing })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: `工作树不存在：${missing}`,
    });
    const escaped = join(repo, '..', `${basename(repo)}-escape`);
    await expect(removeWorktree(repo, { path: escaped })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: `工作树不存在：${escaped}`,
    });
  });

  it('removeWorktree force 透传：dirty 无 force → GIT_ERROR，force → 成功且列表复原', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt dirty');
    dirs.push(wtPath);
    const created = await createWorktree(repo, { path: wtPath, newBranch: 'dirty-b' });
    const wt = created.worktrees.find((w) => samePath(w.path, wtPath));
    expect(wt).toBeDefined();
    writeFileSync(join(wtPath, 'a.txt'), 'dirty payload');

    await expect(removeWorktree(repo, { path: wt!.path })).rejects.toMatchObject({ code: 'GIT_ERROR' });

    const list = await removeWorktree(repo, { path: wt!.path, force: true });
    expect(list.worktrees).toHaveLength(1);
  });

  it('pruneWorktrees：目录缺失的陈旧条目被清理', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt stale');
    await createWorktree(repo, { path: wtPath, newBranch: 'stale-b' });
    rmSync(wtPath, { recursive: true, force: true });
    expect((await getWorktrees(repo)).worktrees).toHaveLength(2); // 未 prune 前仍列出

    const list = await pruneWorktrees(repo);

    expect(list.worktrees).toHaveLength(1);
  });
});
