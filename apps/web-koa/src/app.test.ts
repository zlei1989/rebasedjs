/**
 * web-koa 应用集成测试：node:http 起 ephemeral 端口实测 app.callback()。
 * 断言端点形状、统一错误映射（{error:{code,message}} + 状态码）与 SSE 首帧（真实字节流）。
 * SSE 请求用 { agent: false }（不复用池化连接）：慢速 git 夹具窗口会跨过 server 默认
 * keepAliveTimeout(5s)，Windows 下复用恰好过期套接字会 read ECONNRESET。
 * 每用例独立 REBASED_CONFIG_DIR（空注册表）；成功路径先注册临时 git 仓库。
 */
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createServer, get as httpGet, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app';

let server: Server | undefined;
let base = '';
let dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 建临时 git 仓库（一次提交，可选工作区改动供 diff 流产帧）并写入配置注册表，返回注册 repoId */
function registerRepo(opts: { modify?: boolean } = {}): { repoId: string; repoPath: string } {
  const repo = tmpDir('rebased-web-koa-repo-');
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

/** SSE/流式读取：收集整个响应体为文本 */
function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    res.on('data', (c: Buffer) => (body += c.toString('utf8')));
    res.on('end', () => resolve(body));
    res.on('error', reject);
  });
}

beforeAll(async () => {
  server = createServer(app.callback());
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-koa-config-');
});

afterEach(() => {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('web-koa REST 端点', () => {
  it('status 端点：已注册仓库返回 200 与 RepoStatus 形状', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ahead: number; behind: number; entries: unknown[]; branch: unknown };
    expect(body).toMatchObject({ ahead: 0, behind: 0, entries: [] });
    expect(typeof body.branch).toBe('string');
  });

  it('open 端点：空 path 返回 400 INVALID_QUERY', async () => {
    const res = await fetch(`${base}/api/repos/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('open 端点：非 git 目录返回 400 NOT_A_GIT_REPO', async () => {
    const dir = tmpDir('rebased-web-koa-plain-');
    const res = await fetch(`${base}/api/repos/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_A_GIT_REPO' } });
  });

  it('status 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/status`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('repos 端点：空注册表返回 200 与空数组', async () => {
    const res = await fetch(`${base}/api/repos`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('log 端点：已注册仓库返回 200 与 LogPage 形状', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/log`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasMore: boolean; commits: Array<{ message: string; author: string }> };
    expect(body).toMatchObject({ hasMore: false });
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toContain('init');
    expect(body.commits[0].author).toBe('Test User');
  });

  it('log 端点：limit 超界返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/log?limit=9999`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('diff 端点：已注册仓库 + file 返回 200 与 FileVersions 形状', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/diff?file=a.txt`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ before: 'hello\n', after: 'hello\n' });
  });

  it('diff 端点：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/diff`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('settings 端点：GET 返回默认设置，PUT 局部更新后回读生效', async () => {
    const beforeRes = await fetch(`${base}/api/settings`);
    expect(beforeRes.status).toBe(200);
    expect(await beforeRes.json()).toEqual({ logInEditor: true, recentRepoIds: [] });

    const res = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logInEditor: false }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ logInEditor: false });

    const afterRes = await fetch(`${base}/api/settings`);
    expect(await afterRes.json()).toMatchObject({ logInEditor: false });
  });

  it('config 端点：GET 返回 200 且 entries 覆盖 user.name 白名单键', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ key: string; localValue: string | null }> };
    const entry = body.entries.find((e) => e.key === 'user.name');
    expect(entry).toBeDefined();
    expect(entry!.localValue).toBe('Test User'); // 夹具仓库本地已设 user.name
  });

  it('config 端点：PUT 白名单键返回 200 且刷新视图 localValue 生效', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'user.name', value: '李四' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ key: string; localValue: string | null }> };
    expect(body.entries.find((e) => e.key === 'user.name')!.localValue).toBe('李四');
  });

  it('config 端点：PUT 白名单外键返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'core.hooksPath', value: '/x' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('config 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/config`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('operation 端点：无进行中操作返回 200 与 {kind:"none"}', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/operation`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'none' });
  });

  it('operation/abort 端点：无进行中操作返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/operation/abort`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('operation 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/operation`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});

describe('web-koa SSE 端点', () => {
  it('log/stream：SSE 响应头齐全，首帧为 log.line（有限流可读尽）', async () => {
    const { repoId } = registerRepo();
    const body = await new Promise<string>((resolve, reject) => {
      const req = httpGet(`${base}/api/repos/${repoId}/log/stream`, { agent: false }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers.connection).toBe('keep-alive');
        readBody(res).then(resolve, reject);
      });
      req.on('error', reject);
    });
    expect(body.startsWith('data: {"type":"log.line"')).toBe(true);
    expect(body).toContain('init');
  });

  it('log/stream：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/log/stream`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('log/stream：git 执行失败 → 流内 stream.error 帧后关闭，不崩响应', async () => {
    const { repoId, repoPath } = registerRepo();
    rmSync(repoPath, { recursive: true, force: true }); // 注册后删除仓库目录 → streamLogEvents 抛 GIT_ERROR
    const body = await new Promise<string>((resolve, reject) => {
      const req = httpGet(`${base}/api/repos/${repoId}/log/stream`, { agent: false }, (res) => {
        expect(res.statusCode).toBe(200);
        readBody(res).then(resolve, reject);
      });
      req.on('error', reject);
    });
    expect(body).toContain('"type":"stream.error"');
    expect(body).not.toContain('"type":"log.line"');
  });

  it('diff/stream：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/diff/stream`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('diff/stream：工作区改动 → 首帧 diff.chunk', async () => {
    const { repoId } = registerRepo({ modify: true });
    const body = await new Promise<string>((resolve, reject) => {
      const req = httpGet(`${base}/api/repos/${repoId}/diff/stream?file=a.txt`, { agent: false }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        readBody(res).then(resolve, reject);
      });
      req.on('error', reject);
    });
    expect(body.startsWith('data: {"type":"diff.chunk"')).toBe(true);
    expect(body).toContain('world');
  });

  it('events：首帧 repo.state-changed；断开后服务仍存活（取消链路不崩进程）', async () => {
    const { repoId } = registerRepo();
    const firstFrame = await new Promise<string>((resolve, reject) => {
      const req = httpGet(`${base}/api/repos/${repoId}/events`, { agent: false }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        let seen = '';
        res.on('data', (c: Buffer) => {
          seen += c.toString('utf8');
          if (seen.includes('data: ')) {
            req.destroy(); // 模拟客户端断开：req close → AbortController → 轮询退出
            resolve(seen);
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
    });
    expect(firstFrame).toContain('"type":"repo.state-changed"');
    // 断开后短暂等待，再验证应用可继续服务（无未捕获错误/未崩溃）
    await new Promise((resolve) => setTimeout(resolve, 250));
    const res = await fetch(`${base}/api/repos`);
    expect(res.status).toBe(200);
    await res.json();
  });

  it('events：状态变化（新增未跟踪文件）→ 下一轮轮询推送第二帧', async () => {
    const { repoId, repoPath } = registerRepo();
    const frames = await new Promise<string[]>((resolve, reject) => {
      const collected: string[] = [];
      let settled = false;
      const timer = setTimeout(() => settle(new Error('等待第二帧超时')), 8000);
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err && collected.length < 2) reject(err);
        else resolve(collected);
      };
      const req = httpGet(`${base}/api/repos/${repoId}/events`, { agent: false }, (res) => {
        expect(res.statusCode).toBe(200);
        let buf = '';
        res.on('data', (c: Buffer) => {
          buf += c.toString('utf8');
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            collected.push(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
          }
          if (collected.length === 1) {
            // 首帧已到：改变仓库状态（未跟踪文件 → entries 变化 → 状态推送）
            writeFileSync(join(repoPath, 'b.txt'), 'change\n');
          }
          if (collected.length >= 2) {
            req.destroy(); // 两帧到手即可断开
            settle();
          }
        });
        res.on('error', (e: Error) => settle(e));
      });
      req.on('error', (e: Error) => settle(e));
    });
    expect(frames).toHaveLength(2);
    expect(frames[0]).toContain('"type":"repo.state-changed"');
    expect(frames[1]).toContain('"type":"repo.state-changed"');
    expect(frames[1]).toContain('b.txt'); // 新未跟踪文件出现在第二帧状态里
  });
});
