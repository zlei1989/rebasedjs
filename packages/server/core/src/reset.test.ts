import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitExitError } from './exec';
import { resetToRef, verifyCommitish } from './reset';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 夹具无初始提交：造 base 提交，返回 base 哈希 */
function makeBaseCommit(repo: string): string {
  writeFileSync(join(repo, 'a.txt'), 'base');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return git(repo, ['rev-parse', 'HEAD']);
}

/** 在 base 之上造第二提交（修改 a.txt） */
function makeSecondCommit(repo: string): void {
  writeFileSync(join(repo, 'a.txt'), 'second');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'second']);
}

describe('reset 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('soft 重置到 HEAD~1：HEAD 回到 base，改动保留在暂存列', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const base = makeBaseCommit(repo);
    makeSecondCommit(repo);

    await resetToRef(repo, 'HEAD~1', 'soft');

    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(base);
    // 暂存列（第一列）为 M：soft 重置保留 index，第二提交的改动处于已暂存状态
    const status = git(repo, ['status', '--porcelain']);
    expect(status).toBe('M  a.txt');
  });

  it('hard 重置到 HEAD~1：工作区文件回到 base 内容，status 干净', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    makeSecondCommit(repo);

    await resetToRef(repo, 'HEAD~1', 'hard');

    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('base');
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('无效 ref rejects GitExitError', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await expect(resetToRef(repo, 'nope-ref', 'mixed')).rejects.toBeInstanceOf(GitExitError);
  });

  it('verifyCommitish：提交/标签类 ref → true，无效 ref → false', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const base = makeBaseCommit(repo);

    await expect(verifyCommitish(repo, 'HEAD')).resolves.toBe(true);
    await expect(verifyCommitish(repo, base)).resolves.toBe(true);
    await expect(verifyCommitish(repo, 'HEAD~1')).resolves.toBe(false);
    await expect(verifyCommitish(repo, 'nope-ref')).resolves.toBe(false);
  });
});
