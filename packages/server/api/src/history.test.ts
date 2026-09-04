import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceError } from '@rebased/contracts';
import { getFileHistory } from './history';
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

describe('getFileHistory 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 成功矩阵：三提交 → 条目序列（最新在前）与字段完整透传
  it('三提交文件历史：最新在前且字段完整', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'f.txt', 'one', 'first');
    const h2 = commitFile(repo, 'f.txt', 'two', 'second');
    const h3 = commitFile(repo, 'f.txt', 'three', 'third');

    const entries = await getFileHistory(repo, 'f.txt');

    expect(entries.map((e) => e.hash)).toEqual([h3, h2, h1]);
    expect(entries.map((e) => e.shortHash)).toEqual([h3.slice(0, 7), h2.slice(0, 7), h1.slice(0, 7)]);
    expect(entries.map((e) => e.subject)).toEqual(['third', 'second', 'first']);
    expect(entries[0].author).toBe('Test User');
    // 日期：%aI 带时区偏移的 ISO，原样透传（new Date() 可解析）
    expect(entries[0].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h3));
    expect(entries[2].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h1));
    for (const entry of entries) {
      expect(Number.isNaN(new Date(entry.dateIso).getTime())).toBe(false);
    }
  });

  // 成功矩阵：git mv 重命名后按新名查询仍返回重命名前提交（--follow 证据）
  it('git mv 重命名：--follow 返回重命名前提交', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    const h2 = commitFile(repo, 'b.txt', 'alpha', 'rename');

    const entries = await getFileHistory(repo, 'b.txt');

    expect(entries.map((e) => e.hash)).toEqual([h2, h1]);
    expect(entries.map((e) => e.subject)).toEqual(['rename', 'create']);
  });

  // 预检：路径越界（.. 路径段）→ INVALID_QUERY
  it('file 含 .. 路径段：INVALID_QUERY 非法的文件路径', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getFileHistory(repo, '../secret.txt'));

    expect(err.code).toBe('INVALID_QUERY');
    expect(err.message).toBe('非法的文件路径');
  });

  // 预检：绝对路径 → INVALID_QUERY
  it('file 为绝对路径：INVALID_QUERY 非法的文件路径', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getFileHistory(repo, join(repo, 'secret.txt')));

    expect(err.code).toBe('INVALID_QUERY');
    expect(err.message).toBe('非法的文件路径');
  });

  // 预检：文件不存在 → INVALID_REF
  it('文件不存在：INVALID_REF 文件不存在：…', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);

    const err = await rejectError(getFileHistory(repo, 'no-such.txt'));

    expect(err.code).toBe('INVALID_REF');
    expect(err.message).toBe('文件不存在：no-such.txt');
  });
});
