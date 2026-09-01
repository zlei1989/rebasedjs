import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLogPage, streamLogEvents } from './log';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function commit(repo: string, file: string, msg: string): void {
  writeFileSync(join(repo, file), msg);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
}

describe('log 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getLogPage 返回分页与 hasMore 标志', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    for (let i = 1; i <= 3; i++) commit(repo, `f${i}.txt`, `c${i}`);
    const p1 = await getLogPage(repo, { limit: 2, skip: 0 });
    expect(p1.commits).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const p2 = await getLogPage(repo, { limit: 2, skip: 2 });
    expect(p2.commits).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
  });

  it('streamLogEvents 产出契约事件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'only');
    const events = [];
    for await (const e of streamLogEvents(repo, { limit: 10, skip: 0 })) events.push(e);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'log.line', payload: expect.objectContaining({ message: 'only', parents: [] }) });
  });
});
