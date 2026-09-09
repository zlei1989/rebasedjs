/**
 * web-koa SSE 端点集成测试（拆分自 app.test.ts）。
 * 职责：SSE 端点（log/stream、diff/stream、events）的真实字节流断言——响应头
 * （text/event-stream/cache-control/connection）与首帧/流内帧契约（log.line、diff.chunk、
 * stream.error、repo.state-changed、operation.state-changed、refs.changed）。
 * SSE 请求用 { agent: false }（不复用池化连接）：慢速 git 夹具窗口会跨过 server 默认
 * keepAliveTimeout(5s)，Windows 下复用恰好过期套接字会 read ECONNRESET。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR；afterEach cleanupDirs
 * 清理临时目录（EPERM/EBUSY 重试）。
 */
import { get as httpGet } from 'node:http';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDirs, readBody, registerRepo, startServer, tmpDir } from './testing/integration';

let base = '';
let closeServer: () => Promise<void> = async () => {};

beforeAll(async () => {
  const started = await startServer();
  base = started.base;
  closeServer = started.close;
});

afterAll(async () => {
  await closeServer();
});

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-koa-config-');
});

afterEach(async () => {
  delete process.env.REBASED_CONFIG_DIR;
  await cleanupDirs();
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

  it('events：状态变化（新增未跟踪文件）→ 下一轮轮询推送状态帧（第四帧）', async () => {
    const { repoId, repoPath } = registerRepo();
    const frames = await new Promise<string[]>((resolve, reject) => {
      const collected: string[] = [];
      let settled = false;
      const timer = setTimeout(() => settle(new Error('等待第四帧超时')), 8000);
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err && collected.length < 4) reject(err);
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
          if (collected.length >= 4) {
            req.destroy(); // 四帧到手即可断开
            settle();
          }
        });
        res.on('error', (e: Error) => settle(e));
      });
      req.on('error', (e: Error) => settle(e));
    });
    expect(frames).toHaveLength(4);
    expect(frames[0]).toContain('"type":"repo.state-changed"');
    // 新首帧契约：第二帧为当前操作状态
    expect(frames[1]).toContain('"type":"operation.state-changed"');
    expect(frames[1]).toContain('"kind":"none"');
    // 第三帧：refs.changed 基线（payload.refs 为当前全量 refname 列表）
    expect(frames[2]).toContain('"type":"refs.changed"');
    expect(frames[2]).toContain('refs/heads/');
    expect(frames[3]).toContain('"type":"repo.state-changed"');
    expect(frames[3]).toContain('b.txt'); // 新未跟踪文件出现在状态变化帧里
  });
});
