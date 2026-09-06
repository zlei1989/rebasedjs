/** worktree 原语集成测试（真实 git，Windows msys2 行为实测见 task-2-report） */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { GitExitError } from './exec';
import { addWorktree, listWorktrees, pruneWorktrees, removeWorktree } from './worktree';
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

/**
 * 路径等价比较：git 将 8.3 短路径（%TEMP% 短形式）realpath 为长形式输出，
 * mkdtemp 返回短形式——用 realpathSync.native（OS 级）两侧归一。
 */
function samePath(a: string, b: string): boolean {
  return realpathSync.native(a) === realpathSync.native(b);
}

describe('worktree 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('listWorktrees 单仓库返回主工作树（branch 名与 head 完整哈希）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = makeBaseCommit(repo);
    const headSha = git(repo, ['rev-parse', 'HEAD']);

    const list = await listWorktrees(repo);
    expect(list).toHaveLength(1);
    const main = list[0];
    expect(samePath(main.path, repo)).toBe(true);
    expect(main.branch).toBe(defaultBranch);
    expect(main.detached).toBe(false);
    expect(main.head).toBe(headSha);
  });

  it('addWorktree newBranch 后 list 含主+副（branch 名断言、带空格路径）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt dir');
    dirs.push(wtPath);

    await addWorktree(repo, wtPath, { newBranch: 'feat-2' });

    const list = await listWorktrees(repo);
    expect(list).toHaveLength(2);
    const main = list.find((w) => samePath(w.path, repo));
    const wt = list.find((w) => samePath(w.path, wtPath));
    expect(main).toBeDefined();
    expect(wt).toBeDefined();
    expect(wt?.branch).toBe('feat-2');
    expect(wt?.detached).toBe(false);
    expect(wt?.head).toBe(git(repo, ['rev-parse', 'refs/heads/feat-2']));
  });

  it('addWorktree branch 挂接既有分支（无 -b）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    git(repo, ['branch', 'feat']);
    const wtPath = siblingPath(repo, '-wt attach');
    dirs.push(wtPath);

    await addWorktree(repo, wtPath, { branch: 'feat' });

    const list = await listWorktrees(repo);
    const wt = list.find((w) => samePath(w.path, wtPath));
    expect(wt?.branch).toBe('feat');
    expect(wt?.detached).toBe(false);
  });

  it('addWorktree 无 branch/newBranch 直接抛错（服务层兜底的双保险）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt none');

    await expect(addWorktree(repo, wtPath, {})).rejects.toThrow(/branch 或 newBranch/);
  });

  it('removeWorktree 移除副工作树（目录消失）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt rm');
    dirs.push(wtPath);
    await addWorktree(repo, wtPath, { newBranch: 'rm-branch' });

    await removeWorktree(repo, wtPath);

    expect(await listWorktrees(repo)).toHaveLength(1);
    expect(() => git(wtPath, ['rev-parse', '--git-dir'])).toThrow();
  });

  it('removeWorktree --force 容错未提交变更（无 force 先拒绝）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt dirty');
    dirs.push(wtPath);
    await addWorktree(repo, wtPath, { newBranch: 'dirty-branch' });
    writeFileSync(join(wtPath, 'a.txt'), 'dirty payload');

    await expect(removeWorktree(repo, wtPath, {})).rejects.toBeInstanceOf(GitExitError);
    await removeWorktree(repo, wtPath, { force: true });

    expect(await listWorktrees(repo)).toHaveLength(1);
  });

  it('pruneWorktrees 清理目录缺失的陈旧条目', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const wtPath = siblingPath(repo, '-wt stale');
    await addWorktree(repo, wtPath, { newBranch: 'stale-branch' });
    rmSync(wtPath, { recursive: true, force: true });
    expect(await listWorktrees(repo)).toHaveLength(2); // 未 prune 前仍列出

    await pruneWorktrees(repo);

    expect(await listWorktrees(repo)).toHaveLength(1);
  });

  it('detached 工作树：detached=true、branch=null、head=短哈希', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const headSha = git(repo, ['rev-parse', 'HEAD']);
    const wtPath = siblingPath(repo, '-wt detach');
    dirs.push(wtPath);
    git(repo, ['worktree', 'add', '-q', '--detach', wtPath, 'HEAD']);

    const list = await listWorktrees(repo);
    const wt = list.find((w) => samePath(w.path, wtPath));
    expect(wt?.detached).toBe(true);
    expect(wt?.branch).toBeNull();
    expect(wt?.head).toBe(headSha.slice(0, 7));
  });
});
