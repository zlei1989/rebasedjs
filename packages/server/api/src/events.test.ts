import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertAccount } from './auth';
import { watchRepoStatus } from './events';
import type { RepoStateEvent } from './events';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** events 泄露守卫探针 token：结构上不应出现在任何事件载荷中 */
const EVENTS_PROBE_TOKEN = 'events-leak-probe-token-1a2b3c4d5e6f';

beforeAll(() => {
  // 账户簿记写入应用配置：测试隔离到临时目录，绝不触碰真实 ~/.rebasedjs
  process.env.REBASED_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
});

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args]);
}

/** 造真实 merge 冲突留下 MERGE_HEAD：fixture 无首个提交且默认分支名随 git 版本不同，用 symbolic-ref 取主分支名 */
function createMergeConflict(repo: string): void {
  const main = execFileSync('git', ['-C', repo, 'symbolic-ref', 'HEAD', '--short']).toString().trim();
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'side']);
  git(repo, ['checkout', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'main']);
  try {
    git(repo, ['merge', 'side']);
  } catch {
    // merge 冲突以非零退出码结束，忽略
  }
}

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

  it('首帧依次产 repo.state-changed、operation.state-changed 与 refs.changed（基线全量 refname 列表）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const events = await collect(repo, { count: 3, intervalMs: 100 });
    expect(events.map((e) => e.type)).toEqual(['repo.state-changed', 'operation.state-changed', 'refs.changed']);
    expect(events[1].payload).toEqual({ kind: 'none' });
    // 无提交的空仓库：refs 基线为空列表
    expect(events[2].payload).toEqual({ refs: [] });
  });

  it('轮询中途操作状态变化（merge 冲突）→ 推送 operation.state-changed', { timeout: 60000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    const seen: RepoStateEvent[] = [];
    let firstThreeResolve!: () => void;
    const firstThree = new Promise<void>((r) => { firstThreeResolve = r; });
    const watching = (async () => {
      for await (const e of watchRepoStatus(repo, { intervalMs: 100, signal: ac.signal })) {
        seen.push(e);
        if (seen.length === 3) firstThreeResolve(); // 首帧 repo + operation + refs.changed 基线已消费
        if (e.type === 'operation.state-changed' && e.payload.kind === 'merge') break; // break 触发 generator return，完整退出轮询
      }
    })();
    try {
      await firstThree;
      createMergeConflict(repo); // 流建立后制造 MERGE_HEAD → 下一轮轮询应检测出操作变化
      await watching;
    } finally {
      ac.abort(); // 兜底：超时/断言失败路径也确保生成器退出，避免 afterAll 清目录时 EPERM
      await watching.catch(() => {});
    }
    const opFrames = seen.filter((e): e is Extract<RepoStateEvent, { type: 'operation.state-changed' }> => e.type === 'operation.state-changed');
    expect(opFrames.map((e) => e.payload.kind)).toEqual(['none', 'merge']);
  });

  it('轮询中途建分支 → 推送 refs.changed（payload.refs 含新分支完整 refname）', { timeout: 60000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // 夹具无初始提交：先造 base 提交，refs 基线含主分支
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);
    const ac = new AbortController();
    const seen: RepoStateEvent[] = [];
    let baselineResolve!: () => void;
    const baseline = new Promise<void>((r) => { baselineResolve = r; });
    const watching = (async () => {
      for await (const e of watchRepoStatus(repo, { intervalMs: 100, signal: ac.signal })) {
        seen.push(e);
        if (seen.length === 3) baselineResolve(); // 首帧三帧（含 refs.changed 基线）已消费
        if (seen.length > 3 && e.type === 'refs.changed') break; // 第二帧 refs.changed = 建分支后的变化帧
      }
    })();
    try {
      await baseline;
      git(repo, ['branch', 'topic']); // 只动 refs，不动工作区/操作态 → 下一轮应只产 refs.changed
      await watching;
    } finally {
      ac.abort(); // 兜底：超时/断言失败路径也确保生成器退出
      await watching.catch(() => {});
    }
    const main = execFileSync('git', ['-C', repo, 'symbolic-ref', 'HEAD', '--short']).toString().trim();
    expect(seen.slice(0, 3).map((e) => e.type)).toEqual(['repo.state-changed', 'operation.state-changed', 'refs.changed']);
    // 基线帧：当前全量 refname 列表（本仓库仅主分支）
    const baselineFrame = seen[2];
    if (baselineFrame.type !== 'refs.changed') throw new Error('第 3 帧应为 refs.changed 基线');
    expect(baselineFrame.payload.refs).toEqual([`refs/heads/${main}`]);
    // 变化帧：diff 名单含新分支完整 refname
    const last = seen[seen.length - 1];
    if (last.type !== 'refs.changed') throw new Error('末帧应为 refs.changed 变化帧');
    expect(last.payload.refs).toEqual(['refs/heads/topic']);
  });

  it('首产当前状态，变化后产新事件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // 契约扩展后首帧为 repo + operation + refs.changed 三帧，状态变化帧是第 4 帧
    const p = collect(repo, { count: 4, intervalMs: 100 });
    // 等初始快照产完再写文件（本机首读约 1.1s，300ms 会输掉竞态）：事件 4 必须来自轮询 diff
    await new Promise((r) => setTimeout(r, 2000));
    writeFileSync(join(repo, 'a.txt'), 'hello'); // 触发状态变化
    const events = await p;
    expect(events).toHaveLength(4);
    expect(events[0].type).toBe('repo.state-changed');
    expect(events[2].type).toBe('refs.changed');
    const last = events[3];
    if (last.type !== 'repo.state-changed') throw new Error('第 4 帧应为状态变化事件');
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

  it('泄露守卫：账户簿记中的探针 token 不出现在 events 首帧三帧（hardening ⑲）', async () => {
    upsertAccount({ host: 'events-probe.example.com', account: 'tester', token: EVENTS_PROBE_TOKEN });
    const repo = createTmpRepo();
    dirs.push(repo);
    const events = await collect(repo, { count: 3, intervalMs: 100 });
    expect(events.map((e) => e.type)).toEqual(['repo.state-changed', 'operation.state-changed', 'refs.changed']);
    // 结构保证的可执行化：token 只经 extraConfig 单次调用注入，任何事件帧序列化后不得含 token 本体
    expect(JSON.stringify(events)).not.toContain(EVENTS_PROBE_TOKEN);
  });
});
