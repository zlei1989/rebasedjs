import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitExitError } from './exec';
import { checkoutBranch, checkoutDetached, checkoutNewBranch } from './checkout';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 夹具无初始提交：先造 base 提交，返回默认分支名 */
function makeBaseCommit(repo: string): string {
  const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return defaultBranch;
}

describe('checkout 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('checkoutNewBranch 后 HEAD 指向新分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await checkoutNewBranch(repo, 'n1');
    expect(git(repo, ['symbolic-ref', 'HEAD', '--short'])).toBe('n1');
  });

  it('checkoutBranch 切回既有分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = makeBaseCommit(repo);
    await checkoutNewBranch(repo, 'n1');

    await checkoutBranch(repo, defaultBranch);
    expect(git(repo, ['symbolic-ref', 'HEAD', '--short'])).toBe(defaultBranch);
  });

  it('checkoutDetached 检出提交哈希后进入 detached HEAD', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const hash = git(repo, ['rev-parse', 'HEAD']);

    await checkoutDetached(repo, hash);
    // detached：symbolic-ref -q HEAD 以非零码退出
    expect(() => git(repo, ['symbolic-ref', '-q', 'HEAD'])).toThrow();
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(hash);
  });

  it('检出不存在的引用 rejects GitExitError', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await expect(checkoutBranch(repo, 'ghost')).rejects.toBeInstanceOf(GitExitError);
  });
});
