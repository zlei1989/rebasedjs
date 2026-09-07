import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceError } from '@rebased/contracts';
import { getBrowseContent, getBrowseTree } from './browse';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 写文件 + 提交，返回提交哈希 */
function commitFile(repo: string, file: string, content: string, msg: string): string {
  mkdirSync(join(repo, file.slice(0, file.lastIndexOf('/'))), { recursive: true });
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
  return git(repo, 'rev-parse', 'HEAD');
}

/** 捕获 reject 并返回 ServiceError（message 为 Error 非枚举属性，toMatchObject 不稳，故显式取值断言） */
async function rejectError(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (e) {
    return e as ServiceError;
  }
  throw new Error('期望抛出 ServiceError 但未抛错');
}

describe('getBrowseTree 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 成功矩阵：嵌套目录全量平铺 + 子模块 gitlink 呈 commit 类型 + rev 回显
  it('嵌套文件树：条目全量、子模块呈 commit、回显 rev', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'A.txt', 'a', 'add A');
    commitFile(repo, 'src/lib/b.ts', 'b', 'add b');
    execFileSync('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', '160000,2222222222222222222222222222222222222222,sub/lib']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add gitlink']);
    const rev = git(repo, 'rev-parse', 'HEAD');

    const tree = await getBrowseTree(repo, rev);

    expect(tree.rev).toBe(rev);
    const paths = tree.entries.map((e) => e.path);
    expect(paths).toContain('A.txt');
    expect(paths).toContain('src/lib/b.ts');
    const gitlink = tree.entries.find((e) => e.path === 'sub/lib');
    expect(gitlink?.type).toBe('commit');
    expect(gitlink?.mode).toBe('160000');
  });

  // ref 形态：当前分支名与 HEAD~1 均可作为 rev（verifyCommitish 通过）；HEAD 与分支名同解
  it('rev 接受分支名与 HEAD 相对语法（tree-ish 解析）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'f.txt', 'one', 'first');
    commitFile(repo, 'f.txt', 'two', 'second');
    const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

    const byBranch = await getBrowseTree(repo, branch);
    const byParent = await getBrowseTree(repo, 'HEAD~1');

    expect(byBranch.entries.map((e) => e.path)).toEqual(byParent.entries.map((e) => e.path));
    expect(byParent.entries).toHaveLength(1);
  });

  // 无效 rev → INVALID_REF
  it('无效 rev：INVALID_REF 无效的 ref：…', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getBrowseTree(repo, 'no-such-ref'));

    expect(err.code).toBe('INVALID_REF');
    expect(err.message).toBe('无效的 ref：no-such-ref');
  });
});

describe('getBrowseContent 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 文本文件：content 透传 + binary=false
  it('文本文件内容：原文透传、binary=false', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const rev = commitFile(repo, 'src/a.txt', 'hello\nworld\n', 'add');

    const result = await getBrowseContent(repo, { rev, file: 'src/a.txt' });

    expect(result.content).toBe('hello\nworld\n');
    expect(result.binary).toBe(false);
  });

  // 二进制（含 NUL 字节）：binary=true
  it('含 NUL 字节文件：binary=true', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const rev = commitFile(repo, 'img.bin', 'PNG\u0000\u0001\u0002\u0003payload', 'add binary');

    const result = await getBrowseContent(repo, { rev, file: 'img.bin' });

    expect(result.binary).toBe(true);
  });

  // 路径越界 → INVALID_QUERY
  it('file 含 .. 路径段：INVALID_QUERY 非法的文件路径', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const rev = commitFile(repo, 'a.txt', 'x', 'add');

    const err = await rejectError(getBrowseContent(repo, { rev, file: '../secret' }));

    expect(err.code).toBe('INVALID_QUERY');
    expect(err.message).toBe('非法的文件路径');
  });

  // 该版本不存在该文件（后随提交删除）→ INVALID_REF；旧版本仍可读到内容（browse 语义：版本内读取，不受工作区状态影响）
  it('文件在版本中不存在：INVALID_REF 文件不存在于该版本：…；旧版本仍可读取', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const rev = commitFile(repo, 'a.txt', 'x', 'add');
    execFileSync('git', ['-C', repo, 'rm', '-q', 'a.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'delete']);

    // 旧版本存在该文件：正常返回内容（git rm 不影响历史版本读取）
    const old = await getBrowseContent(repo, { rev, file: 'a.txt' });
    expect(old.content).toBe('x');
    expect(old.binary).toBe(false);

    // 最新版本（已删除）上请求该文件 → INVALID_REF
    const headRev = git(repo, 'rev-parse', 'HEAD');
    const err = await rejectError(getBrowseContent(repo, { rev: headRev, file: 'a.txt' }));
    expect(err.code).toBe('INVALID_REF');
    expect(err.message).toBe('文件不存在于该版本：a.txt');
  });
});
