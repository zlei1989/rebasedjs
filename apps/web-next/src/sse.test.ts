/**
 * web-next SSE 路由测试：直接调 route 函数（不起 Next 服务），断言首帧序列化、
 * 取消链路（request.signal → 流关闭）与流错误帧（streamLogEvents 抛错 → stream.error 帧后不崩响应）。
 * 同 routes.test.ts：每用例独立 REBASED_CONFIG_DIR；成功路径注册真实临时 git 仓库。
 * 末尾附 LogPage 容器流式合并语义（Ruling 6）的纯函数用例。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getLogStream } from '../app/api/repos/[repoId]/log/stream/route';
import { GET as getDiffStream } from '../app/api/repos/[repoId]/diff/stream/route';
import { GET as getEvents } from '../app/api/repos/[repoId]/events/route';
import { mergeLogCommits } from './log-merge';

/** Next 16：route 第二参的 params 为 Promise */
function ctx(repoId: string): { params: Promise<{ repoId: string }> } {
  return { params: Promise.resolve({ repoId }) };
}

let dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 建临时 git 仓库（一次提交）并写入配置注册表，返回 { repoId, repoPath }；modify 时追加工作区改动（供 diff 流产帧） */
function registerRepo(opts: { modify?: boolean } = {}): { repoId: string; repoPath: string } {
  const repo = tmpDir('rebased-web-next-repo-');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test User']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  if (opts.modify) writeFileSync(join(repo, 'a.txt'), 'hello\nworld\n');
  writeFileSync(
    join(process.env.REBASED_CONFIG_DIR as string, 'config.json'),
    JSON.stringify({
      repos: [{ id: 'r1', path: repo, name: 'tmp-repo', openedAt: new Date().toISOString() }],
      settings: { logInEditor: true, recentRepoIds: ['r1'] },
    }),
  );
  return { repoId: 'r1', repoPath: repo };
}

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-next-config-');
});

afterEach(() => {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('web-next SSE 路由', () => {
  it('log/stream：SSE 响应头齐全，首帧为 log.line（有限流可读尽）', async () => {
    const { repoId } = registerRepo();
    const res = await getLogStream(new Request(`http://localhost/api/repos/${repoId}/log/stream`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
    const body = await res.text();
    expect(body.startsWith('data: {"type":"log.line"')).toBe(true);
    expect(body).toContain('init');
  });

  it('log/stream：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getLogStream(new Request('http://localhost/api/repos/nope/log/stream'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('log/stream：git 执行失败 → 流内 stream.error 帧后关闭，不崩响应', async () => {
    const { repoId, repoPath } = registerRepo();
    rmSync(repoPath, { recursive: true, force: true }); // 注册后删除仓库目录 → streamLogEvents 抛 GIT_ERROR
    const res = await getLogStream(new Request(`http://localhost/api/repos/${repoId}/log/stream`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"type":"stream.error"');
    expect(body).not.toContain('"type":"log.line"');
  });

  it('diff/stream：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await getDiffStream(new Request(`http://localhost/api/repos/${repoId}/diff/stream`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('diff/stream：工作区改动 → 首帧 diff.chunk', async () => {
    const { repoId } = registerRepo({ modify: true });
    const res = await getDiffStream(new Request(`http://localhost/api/repos/${repoId}/diff/stream?file=a.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const body = await res.text();
    expect(body.startsWith('data: {"type":"diff.chunk"')).toBe(true);
    expect(body).toContain('world');
  });

  it('events：首帧 repo.state-changed、第二帧 operation.state-changed；request.signal abort 后流关闭', async () => {
    const { repoId } = registerRepo();
    const ac = new AbortController();
    const res = await getEvents(new Request(`http://localhost/api/repos/${repoId}/events`, { signal: ac.signal }), ctx(repoId));
    expect(res.status).toBe(200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toContain('"type":"repo.state-changed"');
    // 新首帧契约：紧随其后的第二帧为当前操作状态
    const second = await reader.read();
    expect(second.done).toBe(false);
    const secondText = decoder.decode(second.value);
    expect(secondText).toContain('"type":"operation.state-changed"');
    expect(secondText).toContain('"kind":"none"');
    ac.abort(); // SSE 断开 → 取消链路：轮询生成器退出 → 流关闭
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});

describe('LogPage 容器流式合并语义（Ruling 6）', () => {
  const commit = (hash: string) => ({ hash }) as never;

  it('流连接中：流结果为主列表，快照按 hash 去重兜底（同 hash 取流）', () => {
    const streamB = commit('b');
    const merged = mergeLogCommits([commit('b'), commit('c')], [commit('a'), streamB], true);
    expect(merged.map((c: { hash: string }) => c.hash)).toEqual(['a', 'b', 'c']);
    expect(merged[1]).toBe(streamB); // 同 hash 取流侧对象
  });

  it('流连接中但尚无帧：仍展示 REST 快照（首屏）', () => {
    const page = [commit('a'), commit('b')];
    expect(mergeLogCommits(page, [], true)).toEqual(page);
  });

  it('流未连接：回退 REST 快照', () => {
    const page = [commit('a')];
    expect(mergeLogCommits(page, [commit('x')], false)).toEqual(page);
  });
});
