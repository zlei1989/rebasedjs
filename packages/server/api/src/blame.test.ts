import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceError } from '@rebased/contracts';
import { getFileBlame } from './blame';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 写文件 + 提交，返回提交哈希 */
function commitFile(repo: string, file: string, content: string, msg: string): string {
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

describe('getFileBlame 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 成功矩阵：两提交改同一行 → 逐行归属 + 字段完整透传（含日期为合法 ISO，new Date() 可解析）
  it('两提交改同一行：逐行归属且字段完整', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'f.txt', 'alpha\nbeta', 'first');
    const h2 = commitFile(repo, 'f.txt', 'alpha\nBETA', 'second');

    const lines = await getFileBlame(repo, 'f.txt');

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.content)).toEqual(['alpha', 'BETA']);
    expect(lines[0]).toMatchObject({
      lineno: 1,
      hash: h1,
      shortHash: h1.slice(0, 7),
      author: 'Test User',
      authorEmail: 'test@example.com',
      previousLineno: null,
    });
    expect(lines[1]).toMatchObject({ lineno: 2, hash: h2, shortHash: h2.slice(0, 7), previousLineno: 2 });
    // 日期：blame 为 author-time epoch → toISOString（UTC Z 结尾），原样透传
    expect(lines[1].dateIso).toBe(new Date(Number(git(repo, 'log', '-1', '--format=%at', h2)) * 1000).toISOString());
    for (const line of lines) {
      expect(line.dateIso).toMatch(/Z$/);
      expect(Number.isNaN(new Date(line.dateIso).getTime())).toBe(false);
    }
  });

  // 成功矩阵：子目录文件（相对路径）
  it('子目录文件可溯源', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    mkdirSync(join(repo, 'sub'));
    const h1 = commitFile(repo, 'sub/f.txt', 'x\ny', 'first');

    const lines = await getFileBlame(repo, 'sub/f.txt');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ lineno: 1, content: 'x', hash: h1 });
  });

  // 预检：路径越界（.. 路径段）→ INVALID_QUERY
  it('file 含 .. 路径段：INVALID_QUERY 非法的文件路径', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getFileBlame(repo, '../secret.txt'));

    expect(err.code).toBe('INVALID_QUERY');
    expect(err.message).toBe('非法的文件路径');
  });

  // 预检：绝对路径 → INVALID_QUERY
  it('file 为绝对路径：INVALID_QUERY 非法的文件路径', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getFileBlame(repo, join(repo, 'secret.txt')));

    expect(err.code).toBe('INVALID_QUERY');
    expect(err.message).toBe('非法的文件路径');
  });

  // 预检：文件不存在 → INVALID_REF
  it('文件不存在：INVALID_REF 文件不存在：…', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getFileBlame(repo, 'no-such.txt'));

    expect(err.code).toBe('INVALID_REF');
    expect(err.message).toBe('文件不存在：no-such.txt');
  });
});
