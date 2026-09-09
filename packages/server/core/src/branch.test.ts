import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitExitError } from './exec';
import {
  createBranch,
  deleteBranch,
  listBranches,
  mergedBranchNames,
  renameBranch,
  setBranchUpstream,
} from './branch';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 夹具无初始提交：先造 base 提交，返回默认分支名（随 git 版本不同，动态取值） */
function makeBaseCommit(repo: string): string {
  const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return defaultBranch;
}

describe('branch 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('listBranches 在 base 提交后含当前分支（current=true、ahead/behind=0）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = makeBaseCommit(repo);
    const headHash = git(repo, ['rev-parse', 'HEAD']);

    const list = await listBranches(repo);
    expect(list).toHaveLength(1);
    const cur = list[0];
    expect(cur.name).toBe(defaultBranch);
    expect(cur.current).toBe(true);
    expect(cur.remote).toBe(false);
    expect(cur.upstream).toBeNull();
    expect(cur.ahead).toBe(0);
    expect(cur.behind).toBe(0);
    expect(cur.hash).toBe(headHash);
    expect(cur.lastCommitIso).toBeTruthy();
  });

  it('createBranch 后列表含新分支且非当前分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await createBranch(repo, 'feat');
    const list = await listBranches(repo);
    const feat = list.find((b) => b.name === 'feat');
    expect(feat).toBeDefined();
    expect(feat?.current).toBe(false);
    expect(feat?.remote).toBe(false);
  });

  it('createBranch 带 startPoint 从指定提交建分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    const baseHash = git(repo, ['rev-parse', 'HEAD']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    git(repo, ['commit', '-q', '-am', 'second']);

    await createBranch(repo, 'feat', baseHash);
    const list = await listBranches(repo);
    expect(list.find((b) => b.name === 'feat')?.hash).toBe(baseHash);
  });

  it('renameBranch 改名生效', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    await createBranch(repo, 'feat');

    await renameBranch(repo, 'feat', 'feature');
    const names = (await listBranches(repo)).map((b) => b.name);
    expect(names).toContain('feature');
    expect(names).not.toContain('feat');
  });

  it('deleteBranch 后分支消失', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    await createBranch(repo, 'feat');

    await deleteBranch(repo, 'feat');
    const names = (await listBranches(repo)).map((b) => b.name);
    expect(names).not.toContain('feat');
  });

  it('删除不存在的分支 rejects GitExitError', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await expect(deleteBranch(repo, 'ghost')).rejects.toBeInstanceOf(GitExitError);
  });

  it('mergedBranchNames 在 base 上含当前分支与同名提交分支', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = makeBaseCommit(repo);
    await createBranch(repo, 'feat');

    const merged = await mergedBranchNames(repo);
    expect(merged).toContain(defaultBranch);
    expect(merged).toContain('feat');
    // 显式 ref 等价于默认 HEAD
    await expect(mergedBranchNames(repo, 'HEAD')).resolves.toEqual(merged);
  });

  it('远程分支 remote=true、跳过 origin/HEAD 符号引用、解析 upstream 轨道', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = makeBaseCommit(repo);

    // 裸仓库充当 origin；另 clone 一份制造远端新提交
    const bare = createTmpDir('rebased-core-bare-');
    dirs.push(bare);
    execFileSync('git', ['init', '-q', '--bare', bare]);
    git(repo, ['remote', 'add', 'origin', bare]);
    git(repo, ['push', '-q', '-u', 'origin', defaultBranch]);
    // 显式建立 refs/remotes/origin/HEAD 符号引用，验证列表会跳过它
    git(repo, ['remote', 'set-head', 'origin', defaultBranch]);

    const other = createTmpDir('rebased-core-other-');
    dirs.push(other);
    execFileSync('git', ['clone', '-q', bare, other]);
    git(other, ['config', 'user.email', 'test@example.com']);
    git(other, ['config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'b.txt'), 'from-other');
    git(other, ['add', 'b.txt']);
    git(other, ['commit', '-q', '-m', 'remote commit']);
    git(other, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);

    // 本地再领先一笔：最终 ahead 1 / behind 1
    writeFileSync(join(repo, 'c.txt'), 'local');
    git(repo, ['add', 'c.txt']);
    git(repo, ['commit', '-q', '-m', 'local commit']);
    git(repo, ['fetch', '-q', 'origin']);

    const list = await listBranches(repo);
    const names = list.map((b) => b.name);
    expect(names).not.toContain('origin/HEAD');

    const local = list.find((b) => b.name === defaultBranch);
    expect(local?.remote).toBe(false);
    expect(local?.upstream).toBe(`origin/${defaultBranch}`);
    expect(local?.ahead).toBe(1);
    expect(local?.behind).toBe(1);

    const remote = list.find((b) => b.name === `origin/${defaultBranch}`);
    expect(remote?.remote).toBe(true);
    expect(remote?.current).toBe(false);
  });

  it('setBranchUpstream 后 upstream 生效', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = makeBaseCommit(repo);

    const bare = createTmpDir('rebased-core-bare-');
    dirs.push(bare);
    execFileSync('git', ['init', '-q', '--bare', bare]);
    git(repo, ['remote', 'add', 'origin', bare]);
    git(repo, ['push', '-q', 'origin', defaultBranch]);
    await createBranch(repo, 'feat');

    await setBranchUpstream(repo, 'feat', `origin/${defaultBranch}`);
    const feat = (await listBranches(repo)).find((b) => b.name === 'feat');
    expect(feat?.upstream).toBe(`origin/${defaultBranch}`);
  });
});
