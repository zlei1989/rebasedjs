import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffRefsSnapshots, takeRefsSnapshot } from './refs';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 夹具无初始提交：先造 base 提交 */
function makeBaseCommit(repo: string): void {
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
}

describe('refs 指纹快照', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('空仓库：指纹稳定、refs 为空、自比 diff 为空', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const s1 = await takeRefsSnapshot(repo);
    const s2 = await takeRefsSnapshot(repo);
    expect(s1.refs).toEqual({});
    expect(s1.fingerprint).toBe(s2.fingerprint);
    expect(diffRefsSnapshots(s1, s2)).toEqual([]);
  });

  it('建分支后指纹变化且 diff 含新分支完整 refname', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const before = await takeRefsSnapshot(repo);
    git(repo, ['branch', 'feat']);
    const after = await takeRefsSnapshot(repo);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(diffRefsSnapshots(before, after)).toEqual(['refs/heads/feat']);
  });

  it('删分支后 diff 含被删 refname（删除检测）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    git(repo, ['branch', 'feat']);
    const before = await takeRefsSnapshot(repo);
    git(repo, ['branch', '-D', 'feat']);
    const after = await takeRefsSnapshot(repo);
    expect(diffRefsSnapshots(before, after)).toEqual(['refs/heads/feat']);
  });

  it('提交移动分支指针后指纹变化且 diff 含该分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const before = await takeRefsSnapshot(repo);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    git(repo, ['commit', '-q', '-am', 'second']);
    const after = await takeRefsSnapshot(repo);
    const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(diffRefsSnapshots(before, after)).toEqual([`refs/heads/${defaultBranch}`]);
  });
});
