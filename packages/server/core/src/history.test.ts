import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileHistory } from './history';
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

describe('history 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 三提交 → 条目序列（最新在前）
  it('三提交文件历史：最新在前且字段完整', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'f.txt', 'one', 'first');
    const h2 = commitFile(repo, 'f.txt', 'two', 'second');
    const h3 = commitFile(repo, 'f.txt', 'three', 'third');

    const entries = await fileHistory(repo, 'f.txt');

    expect(entries.map((e) => e.hash)).toEqual([h3, h2, h1]);
    expect(entries.map((e) => e.subject)).toEqual(['third', 'second', 'first']);
    expect(entries.map((e) => e.shortHash)).toEqual([h3.slice(0, 7), h2.slice(0, 7), h1.slice(0, 7)]);
    expect(entries[0].author).toBe('Test User');
    // %aI 原样透传（严格 ISO 含时区偏移）
    expect(entries[0].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h3));
    expect(entries[2].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h1));
  });

  // git mv 重命名后 fileHistory(新名) 仍返回重命名前提交（--follow 证据）
  it('git mv 重命名：--follow 返回重命名前提交', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    const h2 = commitFile(repo, 'b.txt', 'alpha', 'rename');

    const entries = await fileHistory(repo, 'b.txt');

    expect(entries.map((e) => e.hash)).toEqual([h2, h1]);
    expect(entries.map((e) => e.subject)).toEqual(['rename', 'create']);
  });
});
