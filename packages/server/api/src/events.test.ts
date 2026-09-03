import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchRepoStatus } from './events';
import type { RepoStateEvent } from './events';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

async function collect(repo: string, opts: { count: number; intervalMs?: number; signal?: AbortSignal }): Promise<RepoStateEvent[]> {
  const out: RepoStateEvent[] = [];
  for await (const e of watchRepoStatus(repo, opts)) {
    out.push(e);
    if (out.length >= opts.count) break;
  }
  return out;
}

describe('watchRepoStatus', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('首帧依次产 repo.state-changed 与 operation.state-changed（当前操作）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const p = collect(repo, { count: 2, intervalMs: 100 });
    // 等首帧产完再写文件（本机首读约 1.1s）：写文件凑足状态帧，保证断言针对的是类型而非超时
    await new Promise((r) => setTimeout(r, 2000));
    writeFileSync(join(repo, 'a.txt'), 'hello');
    const events = await p;
    expect(events.map((e) => e.type)).toEqual(['repo.state-changed', 'operation.state-changed']);
    expect(events[1].payload).toEqual({ kind: 'none' });
  });

  it('首产当前状态，变化后产新事件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // 契约扩展后首帧为 repo + operation 两帧，状态变化帧是第 3 帧
    const p = collect(repo, { count: 3, intervalMs: 100 });
    // 等初始快照产完再写文件（本机首读约 1.1s，300ms 会输掉竞态）：事件 3 必须来自轮询 diff
    await new Promise((r) => setTimeout(r, 2000));
    writeFileSync(join(repo, 'a.txt'), 'hello'); // 触发状态变化
    const events = await p;
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('repo.state-changed');
    const last = events[2];
    if (last.type !== 'repo.state-changed') throw new Error('第 3 帧应为状态变化事件');
    expect(last.payload.branch).toBeTruthy();
  });

  it('signal 中止后生成器结束', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    const p = collect(repo, { count: 100, intervalMs: 50, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const events = await p; // abort 后自然结束，不抛错
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
