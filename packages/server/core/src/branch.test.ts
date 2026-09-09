/** branch 原语测试：列表/创建/重命名/删除/已合并/远程轨道/上游设置。
 *  性能：夹具形状在 beforeAll 各建一次模板（base/base+second/远程轨道装置），用例经 instantiateFixture 复制（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitExitError } from './exec';
import {
  createBranch,
  deleteBranch,
  listBranches,
  mergedBranchNames,
  renameBranch,
  setBranchUpstream,
} from './branch';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
  dirs.push(repo);
  return repo;
}

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

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';
let baseTwoTemplate = '';
let baseTwoHash = '';
let remoteSetupTemplate = '';
let remoteSetupBranch = '';
let originBareTemplate = '';
let originBare = '';

beforeAll(() => {
  baseTemplate = createTmpRepo();
  makeBaseCommit(baseTemplate);
  // base + second（startPoint 场景需要 base 哈希）
  baseTwoTemplate = createTmpRepo();
  makeBaseCommit(baseTwoTemplate);
  baseTwoHash = git(baseTwoTemplate, ['rev-parse', 'HEAD']);
  writeFileSync(join(baseTwoTemplate, 'a.txt'), 'v2');
  git(baseTwoTemplate, ['commit', '-q', '-am', 'second']);
  // 远程轨道装置：base + 裸 origin（push -u + set-head）+ other clone 远端新提交 + 本地再领先 + fetch
  remoteSetupTemplate = createTmpRepo();
  remoteSetupBranch = makeBaseCommit(remoteSetupTemplate);
  const bare = createTmpDir('rebased-core-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(remoteSetupTemplate, ['remote', 'add', 'origin', bare]);
  git(remoteSetupTemplate, ['push', '-q', '-u', 'origin', remoteSetupBranch]);
  // 显式建立 refs/remotes/origin/HEAD 符号引用，验证列表会跳过它
  git(remoteSetupTemplate, ['remote', 'set-head', 'origin', remoteSetupBranch]);
  const other = createTmpDir('rebased-core-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  writeFileSync(join(other, 'b.txt'), 'from-other');
  git(other, ['add', 'b.txt']);
  git(other, ['commit', '-q', '-m', 'remote commit']);
  git(other, ['push', '-q', 'origin', `HEAD:${remoteSetupBranch}`]);
  // 本地再领先一笔：最终 ahead 1 / behind 1
  writeFileSync(join(remoteSetupTemplate, 'c.txt'), 'local');
  git(remoteSetupTemplate, ['add', 'c.txt']);
  git(remoteSetupTemplate, ['commit', '-q', '-m', 'local commit']);
  git(remoteSetupTemplate, ['fetch', '-q', 'origin']);
  // 上游设置装置：base + 裸 origin（已 push）
  originBareTemplate = createTmpRepo();
  makeBaseCommit(originBareTemplate);
  originBare = createTmpDir('rebased-core-bare-');
  execFileSync('git', ['init', '-q', '--bare', originBare]);
  git(originBareTemplate, ['remote', 'add', 'origin', originBare]);
  git(originBareTemplate, ['push', '-q', 'origin', git(originBareTemplate, ['symbolic-ref', 'HEAD', '--short'])]);
  templateDirs.push(baseTemplate, baseTwoTemplate, remoteSetupTemplate, originBareTemplate, bare, other, originBare);
});

describe('branch 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('listBranches 在 base 提交后含当前分支（current=true、ahead/behind=0）', async () => {
    const repo = instantiate(baseTemplate);
    const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
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
    const repo = instantiate(baseTemplate);

    await createBranch(repo, 'feat');
    const list = await listBranches(repo);
    const feat = list.find((b) => b.name === 'feat');
    expect(feat).toBeDefined();
    expect(feat?.current).toBe(false);
    expect(feat?.remote).toBe(false);
  });

  it('createBranch 带 startPoint 从指定提交建分支', async () => {
    const repo = instantiate(baseTwoTemplate);

    await createBranch(repo, 'feat', baseTwoHash);
    const list = await listBranches(repo);
    expect(list.find((b) => b.name === 'feat')?.hash).toBe(baseTwoHash);
  });

  it('renameBranch 改名生效', async () => {
    const repo = instantiate(baseTemplate);
    await createBranch(repo, 'feat');

    await renameBranch(repo, 'feat', 'feature');
    const names = (await listBranches(repo)).map((b) => b.name);
    expect(names).toContain('feature');
    expect(names).not.toContain('feat');
  });

  it('deleteBranch 后分支消失', async () => {
    const repo = instantiate(baseTemplate);
    await createBranch(repo, 'feat');

    await deleteBranch(repo, 'feat');
    const names = (await listBranches(repo)).map((b) => b.name);
    expect(names).not.toContain('feat');
  });

  it('删除不存在的分支 rejects GitExitError', async () => {
    const repo = instantiate(baseTemplate);

    await expect(deleteBranch(repo, 'ghost')).rejects.toBeInstanceOf(GitExitError);
  });

  it('mergedBranchNames 在 base 上含当前分支与同名提交分支', async () => {
    const repo = instantiate(baseTemplate);
    const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    await createBranch(repo, 'feat');

    const merged = await mergedBranchNames(repo);
    expect(merged).toContain(defaultBranch);
    expect(merged).toContain('feat');
    // 显式 ref 等价于默认 HEAD
    await expect(mergedBranchNames(repo, 'HEAD')).resolves.toEqual(merged);
  });

  it('远程分支 remote=true、跳过 origin/HEAD 符号引用、解析 upstream 轨道', async () => {
    const repo = instantiate(remoteSetupTemplate);
    const defaultBranch = remoteSetupBranch;

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
    const repo = instantiate(originBareTemplate);
    const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    await createBranch(repo, 'feat');

    await setBranchUpstream(repo, 'feat', `origin/${defaultBranch}`);
    const feat = (await listBranches(repo)).find((b) => b.name === 'feat');
    expect(feat?.upstream).toBe(`origin/${defaultBranch}`);
  });
});
