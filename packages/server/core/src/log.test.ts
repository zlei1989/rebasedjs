import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLogRecord, streamLog } from './log';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function commit(repo: string, file: string, msg: string): void {
  writeFileSync(join(repo, file), msg);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
}

describe('log 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('parseLogRecord 解析全字段与多行 message', () => {
    const raw = '| * \x01' + ['abc', 'abc123', 'p1 p2', '张三', 'a@b.c', '2026-09-01T10:00:00+08:00', 'HEAD -> main, tag: v1', '第一行\n第二行'].join('\x1f') + '\x02';
    const c = parseLogRecord(raw);
    expect(c.hash).toBe('abc');
    expect(c.parents).toEqual(['p1', 'p2']);
    expect(c.refs).toEqual(['HEAD -> main', 'tag: v1']);
    expect(c.message).toBe('第一行\n第二行');
    expect(c.graph).toBe('| *');
  });

  // 本机 git 命令耗时 ~0.5-1.6s/条（杀软扫描），默认 5s 超时不够，显式放宽
  it('streamLog 在双分支仓库产出全部提交', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'c1');
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'feature']);
    commit(repo, 'b.txt', 'c2');
    const commits = [];
    for await (const c of streamLog(repo, { maxCount: 10 })) commits.push(c);
    expect(commits).toHaveLength(2);
    expect(commits.some((c) => c.message === 'c1')).toBe(true);
    expect(commits.some((c) => c.message === 'c2')).toBe(true);
    expect(commits.every((c) => c.graph.length > 0)).toBe(true);
  });
});
