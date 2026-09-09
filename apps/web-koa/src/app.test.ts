/**
 * web-koa 应用集成测试：node:http 起 ephemeral 端口实测 app.callback()。
 * 断言端点形状、统一错误映射（{error:{code,message}} + 状态码）与 SSE 首帧（真实字节流）。
 * SSE 请求用 { agent: false }（不复用池化连接）：慢速 git 夹具窗口会跨过 server 默认
 * keepAliveTimeout(5s)，Windows 下复用恰好过期套接字会 read ECONNRESET。
 * 每用例独立 REBASED_CONFIG_DIR（空注册表）；成功路径先注册临时 git 仓库。
 * 临时目录清理带 EPERM/EBUSY 重试：Windows 上 git 子进程/SSE 流/杀毒仍持有句柄时 rmSync 抛 EPERM。
 */
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createServer, get as httpGet, type IncomingMessage, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAccount } from '@rebased/api';
import { app } from './app';

let server: Server | undefined;
let base = '';
let dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Windows 上句柄未释放时 rmSync 抛 EPERM/EBUSY（force:true 只忽略 ENOENT）：指数退避重试，耗尽后才抛出 */
async function rmRetry(dir: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') || i === attempts - 1) throw err;
      await sleep(100 * (i + 1));
    }
  }
}

/** 建临时 git 仓库（一次提交，可选工作区改动供 diff 流产帧）并写入配置注册表，返回注册 repoId */
function registerRepo(opts: { modify?: boolean } = {}): { repoId: string; repoPath: string } {
  const repo = tmpDir('rebased-web-koa-repo-');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'gc.auto', '0']); // 禁后台 gc：gc --auto 子进程残留会锁临时目录（Windows EPERM）
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

/** 冲突夹具：在注册仓库上造 side/main 两侧改 a.txt 同一行（合并必冲突，stage 1/2/3 全在） */
function makeConflictScenario(repo: string): void {
  const main = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'side']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'main']);
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

/** 裸仓库对端装置：注册仓库 + bare 当 origin + push -u 建 upstream；裸仓库 HEAD 指默认分支（配方同 api 层 remote 测试） */
function makeRemoteRig(): { repoId: string; repoPath: string; bare: string; defaultBranch: string } {
  const { repoId, repoPath } = registerRepo();
  const defaultBranch = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const bare = tmpDir('rebased-web-koa-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['-C', bare, 'config', 'gc.auto', '0']);
  execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
  execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repoId, repoPath, bare, defaultBranch };
}

/** 第二 clone 对端：提交并推到裸仓库默认分支（制造远端新提交/分叉） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = tmpDir('rebased-web-koa-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  execFileSync('git', ['-C', other, 'config', 'gc.auto', '0']);
  execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
  writeFileSync(join(other, filename), content);
  execFileSync('git', ['-C', other, 'add', filename]);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', `remote: ${filename}`]);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

/** 本地新提交（在指定仓库工作区上） */
function makeLocalCommit(repoPath: string, filename: string, content: string, message: string): void {
  writeFileSync(join(repoPath, filename), content);
  execFileSync('git', ['-C', repoPath, 'add', filename]);
  execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', message]);
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

afterEach(async () => {
  delete process.env.REBASED_CONFIG_DIR;
  const current = dirs;
  dirs = [];
  for (const dir of current) await rmRetry(dir);
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

  it('init 端点：空目录 git init 后注册，返回 {repoId} 且列表可见', async () => {
    const dir = tmpDir('rebased-web-koa-init-');
    const res = await fetch(`${base}/api/repos/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repoId: string };
    expect(body.repoId).toMatch(/^[0-9a-f-]{36}$/);
    const list = (await (await fetch(`${base}/api/repos`)).json()) as Array<{ id: string }>;
    expect(list.map((r) => r.id)).toContain(body.repoId);
  });

  it('init 端点：path 为空返回 400 INVALID_QUERY', async () => {
    const res = await fetch(`${base}/api/repos/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('clone 端点：本地仓库克隆落盘并注册；不存在的源 → GIT_ERROR', { timeout: 60000 }, async () => {
    const { repoId, repoPath } = registerRepo();
    const target = join(tmpdir(), `rebased-web-koa-clone-${Date.now()}`);
    const res = await fetch(`${base}/api/repos/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: repoPath, targetDir: target }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repoId: string };
    expect(body.repoId).not.toBe(repoId); // 新仓库独立注册
    expect(await fetch(`${base}/api/repos/${body.repoId}/status`)).toHaveProperty('status', 200);

    const bad = await fetch(`${base}/api/repos/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: join(tmpdir(), 'no-such-source'), targetDir: join(tmpdir(), `rebased-web-koa-bad-${Date.now()}`) }),
    });
    expect(bad.status).toBe(500);
    expect(await bad.json()).toMatchObject({ error: { code: 'GIT_ERROR' } });
  });

  it('delete 端点：移除后列表复原；未注册 id 幂等返回 {ok:true}', async () => {
    const { repoId } = registerRepo();
    expect((await (await fetch(`${base}/api/repos`)).json()) as unknown[]).toHaveLength(1);
    const res = await fetch(`${base}/api/repos/${repoId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await (await fetch(`${base}/api/repos`)).json()).toEqual([]);
    // 幂等：重复删除同 id 不再报错
    const again = await fetch(`${base}/api/repos/${repoId}`, { method: 'DELETE' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
  });

  it('home-dir 端点：返回 200 与非空 {homeDir}', async () => {
    const res = await fetch(`${base}/api/app/home-dir`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { homeDir: string };
    expect(typeof body.homeDir).toBe('string');
    expect(body.homeDir.length).toBeGreaterThan(0);
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

  it('staging 端点：stage 后返回 200 且 entries 反映暂存状态', async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    const res = await fetch(`${base}/api/repos/${repoId}/staging`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage', paths: ['a.txt'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ path: string; code: string }> };
    const entry = body.entries.find((e) => e.path === 'a.txt');
    expect(entry?.code.startsWith('M.')).toBe(true);
  });

  it('staging 端点：空 paths 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/staging`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage', paths: [] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('staging/hunks 端点：hunk 索引越界返回 400 INVALID_QUERY', async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    const res = await fetch(`${base}/api/repos/${repoId}/staging/hunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage', file: 'a.txt', hunks: [99] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('diff/patch 端点：工作区改动后返回 200 且 text 以 diff --git 开头', async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    const res = await fetch(`${base}/api/repos/${repoId}/diff/patch?file=a.txt`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; text: string };
    expect(body.path).toBe('a.txt');
    expect(body.text.startsWith('diff --git')).toBe(true);
  });

  it('diff/patch 端点：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/diff/patch`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('commit 端点：暂存后提交返回 200 且 hash 为 40 位十六进制', async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);
    const res = await fetch(`${base}/api/repos/${repoId}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '测试提交' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('amend 端点：amend-targets 候选列表 200；amend-specific 重写历史提交 200（提交数不变）', async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'b.txt', 'two\n', 'second');
    const target = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();

    const listRes = await fetch(`${base}/api/repos/${repoId}/commit/amend-targets`);
    expect(listRes.status).toBe(200);
    const targets = (await listRes.json()) as Array<{ hash: string; subject: string }>;
    // init（HEAD 排除）+ second → 只剩 init 一条候选（新→旧）
    expect(targets.map((t) => t.subject)).toEqual(['init']);

    const amendRes = await fetch(`${base}/api/repos/${repoId}/commit/amend-specific`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetHash: target, message: 'init（重写）' }),
    });
    expect(amendRes.status).toBe(200);
    const body = (await amendRes.json()) as { status: string; hash?: string };
    expect(body.status).toBe('success');
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
    const subjects = execFileSync('git', ['-C', repoPath, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n').reverse();
    expect(subjects).toEqual(['init（重写）', 'second']);
    expect(execFileSync('git', ['-C', repoPath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('2');

    // 无效目标 → 400 INVALID_REF
    const badRes = await fetch(`${base}/api/repos/${repoId}/commit/amend-specific`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetHash: 'deadbeef'.repeat(5), message: 'x' }),
    });
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('commit 端点：空 message 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('branches 端点：GET 返回 200 且列表含当前分支（current=true）', async () => {
    const { repoId, repoPath } = registerRepo();
    const current = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = await fetch(`${base}/api/repos/${repoId}/branches`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branches: Array<{ name: string; current: boolean }> };
    const entry = body.branches.find((b) => b.name === current);
    expect(entry).toBeDefined();
    expect(entry!.current).toBe(true);
  });

  it('branches 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/branches`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('branches 端点：POST create 返回 200 且刷新列表含新分支', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/branches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: 'b1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branches: Array<{ name: string }> };
    expect(body.branches.some((b) => b.name === 'b1')).toBe(true);
  });

  it('branches 端点：POST 缺 name 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/branches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('checkout 端点：branch 检出既有分支返回 200 且 branch 为目标名', async () => {
    const { repoId } = registerRepo();
    const createRes = await fetch(`${base}/api/repos/${repoId}/branches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: 'b1' }),
    });
    expect(createRes.status).toBe(200);
    const res = await fetch(`${base}/api/repos/${repoId}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'branch', name: 'b1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branch: string };
    expect(body.branch).toBe('b1');
  });

  it('checkout 端点：检出不存在分支返回 400 INVALID_REF', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'branch', name: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('reset 端点：soft 重置到 HEAD~1 返回 200 且 headHash 回退', async () => {
    const { repoId, repoPath } = registerRepo();
    const baseHash = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'second']);
    const res = await fetch(`${base}/api/repos/${repoId}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'HEAD~1', mode: 'soft' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headHash: string };
    expect(body.headHash).toBe(baseHash);
  });

  it('reset 端点：空 ref 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: '', mode: 'soft' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('reset 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'HEAD~1', mode: 'soft' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('reset/undo-commit 端点：撤销最近提交返回 200 且 headHash 回退', async () => {
    const { repoId, repoPath } = registerRepo();
    const baseHash = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'second']);
    const res = await fetch(`${base}/api/repos/${repoId}/reset/undo-commit`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headHash: string };
    expect(body.headHash).toBe(baseHash);
  });

  it('reset/undo-commit 端点：根提交上再撤销返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo(); // 仅一次提交（根提交）：无可撤销
    const res = await fetch(`${base}/api/repos/${repoId}/reset/undo-commit`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
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

describe('web-koa merge/conflicts 端点', () => {
  it('冲突全流程：merge→conflicts 列表→contents 三版本→resolve theirs→continue→操作态清零', async () => {
    const { repoId, repoPath } = registerRepo();
    makeConflictScenario(repoPath);

    // POST merge：冲突合并 → 200 MergeOutcome{status:'conflicts'} 附带冲突列表
    const mergeRes = await fetch(`${base}/api/repos/${repoId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'side' }),
    });
    expect(mergeRes.status).toBe(200);
    const outcome = (await mergeRes.json()) as { status: string; conflicts: unknown[] };
    expect(outcome.status).toBe('conflicts');
    expect(outcome.conflicts).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);

    // GET conflicts：列出冲突路径
    const listRes = await fetch(`${base}/api/repos/${repoId}/conflicts`);
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

    // GET conflicts/contents：base/ours/theirs 三字段齐
    const contentsRes = await fetch(`${base}/api/repos/${repoId}/conflicts/contents?path=a.txt`);
    expect(contentsRes.status).toBe(200);
    expect(await contentsRes.json()).toEqual({ path: 'a.txt', base: 'hello\n', ours: 'main\n', theirs: 'side\n' });

    // POST conflicts/resolve：theirs 采纳 → 列表变空
    const resolveRes = await fetch(`${base}/api/repos/${repoId}/conflicts/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'theirs', path: 'a.txt' }),
    });
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toEqual({ conflicts: [] });

    // POST merge/continue（无请求体）：产合并提交 → 200 RepoStatus
    const continueRes = await fetch(`${base}/api/repos/${repoId}/merge/continue`, { method: 'POST' });
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opRes = await fetch(`${base}/api/repos/${repoId}/operation`);
    expect(await opRes.json()).toEqual({ kind: 'none' });
  });

  it('merge 端点：空 branch 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('merge 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'side' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('merge/continue 端点：无进行中合并返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/merge/continue`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('conflicts/contents 端点：缺 path 查询参数返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/conflicts/contents`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('conflicts/resolve 端点：非法 strategy 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/conflicts/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'base', path: 'a.txt' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('stashes 端点：GET 返回 200 且空贮藏列表', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/stashes`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stashes: [] });
  });

  it('stashes 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/stashes`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('stashes 端点：save → apply → drop 往返均返回 200 刷新列表', async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    const post = (body: unknown) =>
      fetch(`${base}/api/repos/${repoId}/stashes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const saveRes = await post({ action: 'save', message: 'wip' });
    expect(saveRes.status).toBe(200);
    expect(((await saveRes.json()) as { stashes: unknown[] }).stashes).toHaveLength(1);
    const applyRes = await post({ action: 'apply', index: 0 });
    expect(applyRes.status).toBe(200);
    expect(((await applyRes.json()) as { stashes: unknown[] }).stashes).toHaveLength(1);
    const dropRes = await post({ action: 'drop', index: 0 });
    expect(dropRes.status).toBe(200);
    expect(((await dropRes.json()) as { stashes: unknown[] }).stashes).toHaveLength(0);
  });

  it('stashes 端点：pop 带负 index 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/stashes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pop', index: -1 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('stashes 端点：无工作区改动 save 返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/stashes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('changelists 端点：GET 返回 200 含默认列表', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/changelists`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lists: [{ id: 'default', name: '默认', isDefault: true }],
      assignments: {},
    });
  });

  it('changelists 端点：POST create 返回 200 两列表', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/changelists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: '进行中' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lists: Array<{ id: string; name: string; isDefault: boolean }> };
    expect(body.lists).toHaveLength(2);
    expect(body.lists[0]).toEqual({ id: 'default', name: '默认', isDefault: true });
    expect(body.lists[1]).toMatchObject({ name: '进行中', isDefault: false });
  });

  it('changelists 端点：POST move 到不存在列表返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/changelists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move', paths: ['a.txt'], targetId: 'no-such-list' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('changelists 端点：POST create 缺 name（zod 拒绝）返回 400', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/changelists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create' }),
    });
    expect(res.status).toBe(400);
  });

  it('changelists 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/changelists`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});

describe('web-koa auth 账户端点（应用级，无 repoId）', () => {
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET /api/auth/accounts：空配置返回 200 与空账户列表', async () => {
    const res = await fetch(`${base}/api/auth/accounts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：添加返回掩码视图且响应不含原 token', async () => {
    const token = 'ghp_secret123456';
    const res = await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).toEqual({ accounts: [{ host: 'github.com', account: 'zhang', tokenPreview: 'ghp_***' }] });
  });

  it('POST /api/auth/accounts：同 host+account 重复添加覆盖（列表长度 1）', async () => {
    await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'oldtoken123456' });
    const res = await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'newtoken654321' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ tokenPreview: string }> };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].tokenPreview).toBe('newt***');
  });

  it('POST /api/auth/accounts/delete：删除后列表移除该账户', async () => {
    await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'ghp_abc123' });
    const res = await postJson('/api/auth/accounts/delete', { host: 'github.com', account: 'zhang' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：空 token（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const res = await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('POST /api/auth/accounts/delete：删除不存在账户返回 400 INVALID_QUERY', async () => {
    const res = await postJson('/api/auth/accounts/delete', { host: 'github.com', account: 'nobody' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});

describe('web-koa remotes/fetch/pull/push/update 端点', () => {
  /** 裸仓库装置用例 git 进程密集（本机单次 git 进程启动约秒级），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('remotes 端点：GET 空列表 → add → setUrl → remove 往返均返回刷新 RemoteList', async () => {
    const { repoId } = registerRepo();
    const getRes = await fetch(`${base}/api/repos/${repoId}/remotes`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ remotes: [], shallow: false });

    const addRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' });
    expect(addRes.status).toBe(200);
    expect(await addRes.json()).toEqual({
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' }],
      shallow: false,
    });

    const setUrlRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'setUrl', name: 'origin', url: 'https://example.com/b.git' });
    expect(setUrlRes.status).toBe(200);
    expect(((await setUrlRes.json()) as { remotes: unknown[] }).remotes).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
    ]);

    const removeRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'remove', name: 'origin' });
    expect(removeRes.status).toBe(200);
    expect(await removeRes.json()).toEqual({ remotes: [], shallow: false });
  });

  it('remotes 端点：add 重名 → 400 INVALID_QUERY；remove 不存在 → 400 INVALID_REF', async () => {
    const { repoId } = registerRepo();
    await postJson(`/api/repos/${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' });
    const dupRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/x.git' });
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const removeRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'remove', name: 'nope' });
    expect(removeRes.status).toBe(400);
    expect(await removeRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('remotes 端点：未知 action（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await postJson(`/api/repos/${repoId}/remotes`, { action: 'wat', name: 'origin' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('remotes 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/remotes`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('fetch 端点：对端新提交后 fetch 返回 200 FetchResult（updatedRefs 含对应引用）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postJson(`/api/repos/${repoId}/fetch`, {}); // fetch 体可空 {}
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updatedRefs: string[] };
    expect(body.updatedRefs).toContain(`refs/remotes/origin/${defaultBranch}`);
  });

  it('fetch 端点：remote 非字符串（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await postJson(`/api/repos/${repoId}/fetch`, { remote: 123 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('pull 端点：对端新提交 pull 返回 200 updated 且工作区同步', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postJson(`/api/repos/${repoId}/pull`, { remote: 'origin' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'updated' });
    expect(readFileSync(join(repoPath, 'b.txt'), 'utf8')).toBe('from-other');
  });

  it('pull 端点：rebase 非布尔（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await postJson(`/api/repos/${repoId}/pull`, { rebase: 'yes' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('push 端点：本地新提交 push 返回 200 pushed 且对端可见', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare, defaultBranch } = makeRemoteRig();
    makeLocalCommit(repoPath, 'b.txt', 'local', 'local commit');
    const res = await postJson(`/api/repos/${repoId}/push`, { remote: 'origin', branch: defaultBranch });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pushed' });
    const bareHead = execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim();
    expect(bareHead).toBe(execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  });

  it('push 端点：分叉后 push 返回 200 rejected + 中文 hint（业务结果，不做 409 特判）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    makeLocalCommit(repoPath, 'c.txt', 'local', 'local commit');
    const res = await postJson(`/api/repos/${repoId}/push`, { remote: 'origin', branch: defaultBranch });
    expect(res.status).toBe(200); // PushOutcome.rejected 是 200 业务结果，409 保留给真冲突
    expect(await res.json()).toEqual({ status: 'rejected', hint: '远端有更新的提交，请先拉取/变基' });
  });

  it('push 端点：forceWithLease 非布尔（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await postJson(`/api/repos/${repoId}/push`, { forceWithLease: 'yes' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('push 端点：hash（Push up to Commit）——fetch 后远端领先时 forceWithLease 回推 200 pushed 且对端分支移到该提交；无效 hash → 400 INVALID_REF', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const base = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // force-with-lease 以本地远程跟踪引用为租约期望值（对端领先超出认知时 lease 拒绝）
    execFileSync('git', ['-C', repoPath, 'fetch', '-q', 'origin']);

    const res = await postJson(`/api/repos/${repoId}/push`, { hash: base, remote: 'origin', forceWithLease: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pushed' });
    expect(execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim()).toBe(base);

    const refRes = await postJson(`/api/repos/${repoId}/push`, { hash: 'deadbeef'.repeat(5), remote: 'origin' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('update 端点：merge 策略返回 200 UpdateOutcome（fetched + pull.updated 且工作区同步）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postJson(`/api/repos/${repoId}/update`, { strategy: 'merge' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fetched: string[]; pull: { status: string } };
    expect(body.pull.status).toBe('updated');
    expect(body.fetched).toContain(`refs/remotes/origin/${defaultBranch}`);
    expect(readFileSync(join(repoPath, 'b.txt'), 'utf8')).toBe('from-other');
  });

  it('update 端点：非法 strategy（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await postJson(`/api/repos/${repoId}/update`, { strategy: 'ff-only' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update/force-pushed 端点：对端强推后（本地独有提交）→ 200 success + applied + 树含双方内容；无上游 → 400 INVALID_QUERY', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare, defaultBranch } = makeRemoteRig();
    makeLocalCommit(repoPath, 'l1.txt', 'local1', 'local1');
    makeLocalCommit(repoPath, 'l2.txt', 'local2', 'local2');
    // 对端强推：另一 clone 从 init 起新增 remote-keep
    const other = tmpDir('rebased-web-koa-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 't@e.c']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'T']);
    writeFileSync(join(other, 'r.txt'), 'remote-new');
    execFileSync('git', ['-C', other, 'add', 'r.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'remote-keep']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);

    const res = await postJson(`/api/repos/${repoId}/update/force-pushed`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; applied: string[] };
    expect(body.status).toBe('success');
    expect(body.applied).toHaveLength(2);
    // 重放后树 = remote-keep + local1/local2
    const logSubjects = execFileSync('git', ['-C', repoPath, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
    expect(logSubjects[0]).toBe('local2');
    expect(logSubjects[1]).toBe('local1');
    expect(logSubjects[2]).toBe('remote-keep');
    expect(readFileSync(join(repoPath, 'r.txt'), 'utf8')).toBe('remote-new');

    // 无上游仓库 → 400 INVALID_QUERY
    const noUpstream = registerRepo();
    const badRes = await postJson(`/api/repos/${noUpstream.repoId}/update/force-pushed`, {});
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postJson('/api/repos/nope/update', { strategy: 'merge' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});

describe('web-koa rebase/cherry-pick/revert/tags 端点', () => {
  /** 本组用例 git 进程密集（变基/摘樱桃/裸仓库对端 + log 复核），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  /** 在指定仓库上执行 git（返回 stdout） */
  const git = (repoPath: string, args: string[]): string =>
    execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
  const jsonPost = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const jsonGet = (path: string) => fetch(`${base}${path}`);

  it('rebase 端点：main 上 rebase onto side → 200 success 且历史线性', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const main = git(repoPath, ['symbolic-ref', '--short', 'HEAD']).trim();
    git(repoPath, ['checkout', '-q', '-b', 'side']);
    makeLocalCommit(repoPath, 'side.txt', 'side\n', 'side');
    git(repoPath, ['checkout', '-q', main]);
    makeLocalCommit(repoPath, 'main.txt', 'main\n', 'main');

    const res = await jsonPost(`/api/repos/${repoId}/rebase`, { onto: 'side' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['main', 'side', 'init']);
  });

  it('rebase/todo 端点：base..HEAD 反序返回全量提交（哈希+主题）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');
    const two = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const res = await jsonGet(`/api/repos/${repoId}/rebase/todo?base=${base}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { hash: one, subject: 'one' },
      { hash: two, subject: 'two' },
    ]);
  });

  it('rebase/interactive 端点：drop 中间提交 → 200 success 且 git log 复核（中间提交消失）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');
    const two = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'three.txt', 'three\n', 'three');
    const three = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const res = await jsonPost(`/api/repos/${repoId}/rebase/interactive`, {
      base,
      entries: [
        { hash: one, action: 'pick' },
        { hash: two, action: 'drop' },
        { hash: three, action: 'pick' },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['three', 'one', 'init']);
    expect(git(repoPath, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).toContain('one.txt');
    expect(git(repoPath, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).not.toContain('two.txt');
  });

  it('autosquash 端点：squash! 折入目标提交 → 200 success；无暂存 → 400 INVALID_QUERY；无效哈希 → 400 INVALID_REF', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');
    // 暂存 a.txt 改动（squash 提交携带；a.txt 在目标提交树中存在）
    writeFileSync(join(repoPath, 'a.txt'), 'init2\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);

    const res = await jsonPost(`/api/repos/${repoId}/autosquash`, { hash: base, action: 'squash' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    // 提交数不变（折入）；目标提交信息保留（squash shim 覆写 %B）
    expect(execFileSync('git', ['-C', repoPath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('3');
    expect(git(repoPath, ['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['init', 'one', 'two']);
    void one;

    const emptyRes = await jsonPost(`/api/repos/${repoId}/autosquash`, { hash: base, action: 'fixup' });
    expect(emptyRes.status).toBe(400);
    expect(await emptyRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await jsonPost(`/api/repos/${repoId}/autosquash`, { hash: 'deadbeef'.repeat(5), action: 'fixup' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('cherry-pick 端点：祖先提交摘樱桃 → 200 success', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'c.txt', 'two\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    git(repoPath, ['reset', '-q', '--hard', base]);

    const res = await jsonPost(`/api/repos/${repoId}/cherry-pick`, { hashes: [one] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-2']).trim().split('\n')).toEqual(['one', 'init']);
    expect(git(repoPath, ['show', 'HEAD:c.txt'])).toBe('two\n');
  });

  it('cherry-pick 端点：祖先提交（已在当前分支历史）→ 400 INVALID_QUERY 且不留空补丁停态', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');

    const res = await jsonPost(`/api/repos/${repoId}/cherry-pick`, { hashes: [one] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    // 预检在 git 创建停态之前拦下（复刻终审实验：祖先摘樱桃不再进入空补丁停态）
    expect(existsSync(join(repoPath, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('revert 端点：还原祖先提交 → 200 success 且生成 Revert 提交', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'a.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const res = await jsonPost(`/api/repos/${repoId}/revert`, { hashes: [one] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(git(repoPath, ['show', 'HEAD:a.txt'])).toBe('hello\n');
  });

  it('operation/continue 端点：无进行中操作（无请求体 POST）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/operation/continue`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('rebase 冲突全流程：rebase→conflicts 列表→resolve theirs→operation/continue→操作态清零', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeConflictScenario(repoPath);

    // POST rebase：双向改同一行 → 200 RebaseOutcome{status:'conflicts'}
    const rebaseRes = await jsonPost(`/api/repos/${repoId}/rebase`, { onto: 'side' });
    expect(rebaseRes.status).toBe(200);
    expect(await rebaseRes.json()).toEqual({ status: 'conflicts' });

    // 操作态为 rebase
    const opRes = await jsonGet(`/api/repos/${repoId}/operation`);
    expect(((await opRes.json()) as { kind: string }).kind).toBe('rebase');

    // GET conflicts：冲突路径齐
    const listRes = await jsonGet(`/api/repos/${repoId}/conflicts`);
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

    // POST conflicts/resolve：theirs 采纳 → 列表变空
    const resolveRes = await jsonPost(`/api/repos/${repoId}/conflicts/resolve`, {
      strategy: 'theirs',
      path: 'a.txt',
    });
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toEqual({ conflicts: [] });

    // POST operation/continue（无请求体）：rebase --continue → 200 RepoStatus
    const continueRes = await fetch(`${base}/api/repos/${repoId}/operation/continue`, { method: 'POST' });
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opAfter = await jsonGet(`/api/repos/${repoId}/operation`);
    expect(await opAfter.json()).toEqual({ kind: 'none' });
  });

  it('tags 端点：GET 空 → create 轻量/附注 → push 裸仓库 → delete 往返', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare } = makeRemoteRig();
    const head = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const getRes = await jsonGet(`/api/repos/${repoId}/tags`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ tags: [] });

    // 轻量标签：hash 即提交哈希，subject 即提交主题，annotated=false
    const createLight = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'create', name: 'v1', ref: 'HEAD' });
    expect(createLight.status).toBe(200);
    let list = (await createLight.json()) as { tags: Array<{ name: string; hash: string; subject: string | null; annotated: boolean }> };
    expect(list.tags).toEqual([{ name: 'v1', hash: head, subject: 'init', annotated: false }]);

    // 附注标签：annotated=true，subject 为附注消息
    const createAnnotated = await jsonPost(`/api/repos/${repoId}/tags`, {
      action: 'create',
      name: 'v2',
      message: '发布 1.0',
    });
    expect(createAnnotated.status).toBe(200);
    list = (await createAnnotated.json()) as typeof list;
    const v2 = list.tags.find((t) => t.name === 'v2');
    expect(v2?.annotated).toBe(true);
    expect(v2?.subject).toBe('发布 1.0');

    // push 到裸仓库对端：200 刷新列表且对端 refs/tags/v1 可见
    const pushRes = await jsonPost(`/api/repos/${repoId}/tags`, {
      action: 'push',
      name: 'v1',
      remote: 'origin',
    });
    expect(pushRes.status).toBe(200);
    expect(((await pushRes.json()) as { tags: unknown[] }).tags).toHaveLength(2);
    const bareTag = git(bare, ['rev-parse', 'refs/tags/v1']).trim();
    expect(bareTag).toBe(head);

    // delete：200 刷新列表仅剩 v1
    const deleteRes = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'delete', name: 'v2' });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ tags: [{ name: 'v1', hash: head, subject: 'init', annotated: false }] });
  });

  it('tags 端点：create 重名 → 400 INVALID_QUERY；delete 不存在 → 400 INVALID_REF', async () => {
    const { repoId } = registerRepo();
    await jsonPost(`/api/repos/${repoId}/tags`, { action: 'create', name: 'v1' });
    const dupRes = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'create', name: 'v1' });
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const delRes = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'delete', name: 'ghost' });
    expect(delRes.status).toBe(400);
    expect(await delRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('zod 反例：空 onto / 空 entries / 空 hashes / 缺 base / 未知 tag action 均返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const results = await Promise.all([
      jsonPost(`/api/repos/${repoId}/rebase`, { onto: '' }),
      jsonPost(`/api/repos/${repoId}/rebase/interactive`, { base: 'HEAD', entries: [] }),
      jsonPost(`/api/repos/${repoId}/cherry-pick`, { hashes: [] }),
      jsonGet(`/api/repos/${repoId}/rebase/todo`),
      jsonPost(`/api/repos/${repoId}/tags`, { action: 'rename', name: 'v1' }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：rebase/tags/operation-continue 返回 404 REPO_NOT_FOUND', async () => {
    const rebaseRes = await jsonPost('/api/repos/nope/rebase', { onto: 'side' });
    expect(rebaseRes.status).toBe(404);
    expect(await rebaseRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const tagsRes = await jsonGet('/api/repos/nope/tags');
    expect(tagsRes.status).toBe(404);
    expect(await tagsRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const contRes = await fetch(`${base}/api/repos/nope/operation/continue`, { method: 'POST' });
    expect(contRes.status).toBe(404);
    expect(await contRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});

describe('web-koa blame/history/browse/committed/search 端点', () => {
  /** 本组用例 git 进程密集（多提交/重命名/搜索遍历），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;

  it('blame 端点：两提交后返回 200 且行数/内容/归属字段正确', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const first = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'second']);

    const res = await fetch(`${base}/api/repos/${repoId}/blame?file=a.txt`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ lineno: number; content: string; hash: string; author: string; previousLineno: number | null }>;
    // 行数 = 文件行数；未改动行归属首提交（首创建 → previousLineno null）
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ lineno: 1, content: 'hello', author: 'Test User' });
    expect(body[0].hash).toBe(first);
    expect(body[0].previousLineno).toBeNull();
    // 新增行归属次提交（hash/日期字段齐全）
    expect(body[1]).toMatchObject({ lineno: 2, content: 'world', author: 'Test User' });
    expect(body[1].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('history 端点：git mv 重命名后返回 200 且含重命名前提交（--follow 证据）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    execFileSync('git', ['-C', repoPath, 'mv', 'a.txt', 'b.txt']);
    execFileSync('git', ['-C', repoPath, 'add', '.']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'rename to b']);

    const res = await fetch(`${base}/api/repos/${repoId}/history?file=b.txt`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ subject: string; hash: string; author: string }>;
    // 最新在前：rename 提交 + init 提交（b.txt 在重命名前提交中不存在 → --follow 跟随证据）
    expect(body.map((e) => e.subject)).toEqual(['rename to b', 'init']);
    expect(body[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(body[0].author).toBe('Test User');
  });

  it('browse 端点：rev=HEAD 返回 200 与 BrowseTree 形状；content 返回文本内容与二进制标记', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'b.txt'), 'two\n');
    execFileSync('git', ['-C', repoPath, 'add', 'b.txt']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'second']);

    const res = await fetch(`${base}/api/repos/${repoId}/browse?rev=HEAD`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rev: string; entries: Array<{ mode: string; type: string; hash: string; path: string }> };
    expect(body.rev).toBe('HEAD'); // rev 原样回显（输入即用户所见），终端哈希见条目 hash 字段
    expect(body.entries.map((e) => e.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(body.entries[0]).toMatchObject({ mode: '100644', type: 'blob' });
    expect(body.entries[0].hash).toMatch(/^[0-9a-f]{40}$/);

    const contentRes = await fetch(`${base}/api/repos/${repoId}/browse/content?rev=HEAD&file=a.txt`);
    expect(contentRes.status).toBe(200);
    expect(await contentRes.json()).toEqual({ content: 'hello\n', binary: false });
  });

  it('browse 端点：缺 rev 或无效 rev 返回 400；未注册 repoId 两个端点返回 404 REPO_NOT_FOUND', async () => {
    const { repoId } = registerRepo();
    const missingRes = await fetch(`${base}/api/repos/${repoId}/browse`);
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const badRes = await fetch(`${base}/api/repos/${repoId}/browse?rev=nope`);
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });

    const notFoundRes = await fetch(`${base}/api/repos/nope/browse?rev=HEAD`);
    const contentNotFound = await fetch(`${base}/api/repos/nope/browse/content?rev=HEAD&file=a.txt`);
    for (const res of [notFoundRes, contentNotFound]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });

  it('committed 端点：默认全量 200 hasMore false；limit=1 分页 hasMore true；skip 越界空页', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'b.txt', 'two\n', 'second');
    makeLocalCommit(repoPath, 'c.txt', 'three\n', 'third');

    const fullRes = await fetch(`${base}/api/repos/${repoId}/committed`);
    expect(fullRes.status).toBe(200);
    const full = (await fullRes.json()) as { entries: Array<{ subject: string; author: string; parents: string[]; files: Array<{ path: string; status: string }> }>; hasMore: boolean };
    expect(full.entries).toHaveLength(3);
    expect(full.hasMore).toBe(false);
    // 最新在前：entries[0] 为 third 提交且变更文件集正确
    expect(full.entries[0]).toMatchObject({ subject: 'third', author: 'Test User' });
    expect(full.entries[0].files).toEqual([{ path: 'c.txt', status: 'A' }]);
    expect(full.entries[1].subject).toBe('second');
    expect(full.entries[1].files).toEqual([{ path: 'b.txt', status: 'A' }]);
    // %P 父哈希透传：非根提交单父；根提交（init）无父 → []（容器据此降级根提交 diff，终审 Must-fix 2）
    expect(full.entries[0].parents).toHaveLength(1);
    expect(full.entries[0].parents[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(full.entries[2].parents).toEqual([]);

    const pageRes = await fetch(`${base}/api/repos/${repoId}/committed?limit=1`);
    const page = (await pageRes.json()) as typeof full;
    expect(page.entries).toHaveLength(1);
    expect(page.hasMore).toBe(true);

    const beyondRes = await fetch(`${base}/api/repos/${repoId}/committed?limit=1&skip=3`);
    const beyond = (await beyondRes.json()) as typeof full;
    expect(beyond.entries).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
  });

  it('search 端点：grep 命中提交信息、pickaxe 命中内容增量、无命中空数组，均 200', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'fix.txt', 'patch\n', 'fix: repair the bug');
    makeLocalCommit(repoPath, 'token.txt', 'TOKEN_XYZ\n', 'add token file');

    const grepRes = await fetch(`${base}/api/repos/${repoId}/search?q=FIX&mode=grep`);
    expect(grepRes.status).toBe(200);
    const grepBody = (await grepRes.json()) as Array<{ subject: string; hash: string }>;
    expect(grepBody).toHaveLength(1);
    expect(grepBody[0].subject).toBe('fix: repair the bug');
    expect(grepBody[0].hash).toMatch(/^[0-9a-f]{40}$/);

    const pickRes = await fetch(`${base}/api/repos/${repoId}/search?q=TOKEN_XYZ&mode=pickaxe`);
    expect(pickRes.status).toBe(200);
    const pickBody = (await pickRes.json()) as Array<{ subject: string }>;
    expect(pickBody).toHaveLength(1);
    expect(pickBody[0].subject).toBe('add token file');

    const noneRes = await fetch(`${base}/api/repos/${repoId}/search?q=NOT_PRESENT`);
    expect(noneRes.status).toBe(200);
    expect(await noneRes.json()).toEqual([]);
  });

  it('commits/:hash 端点：单提交全量变更文件 200；无效 hash 400 INVALID_REF；未注册 repoId 404', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'b.txt', 'two\n', 'second');
    const hash = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const res = await fetch(`${base}/api/repos/${repoId}/commits/${hash}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; shortHash: string; subject: string; parents: string[]; files: Array<{ path: string; status: string }> };
    expect(body).toMatchObject({ hash, shortHash: hash.slice(0, 7), subject: 'second' });
    expect(body.parents).toHaveLength(1);
    expect(body.files).toEqual([{ path: 'b.txt', status: 'A' }]);

    const badRes = await fetch(`${base}/api/repos/${repoId}/commits/${'deadbeef'.repeat(5)}`);
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });

    const notFoundRes = await fetch(`${base}/api/repos/nope/commits/${hash}`);
    expect(notFoundRes.status).toBe(404);
    expect(await notFoundRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('blame/history/search 端点：缺必填查询参数（file/q）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const blameRes = await fetch(`${base}/api/repos/${repoId}/blame`);
    const historyRes = await fetch(`${base}/api/repos/${repoId}/history`);
    const searchRes = await fetch(`${base}/api/repos/${repoId}/search`);
    for (const res of [blameRes, historyRes, searchRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：blame/history/committed/search 返回 404 REPO_NOT_FOUND', async () => {
    const blameRes = await fetch(`${base}/api/repos/nope/blame?file=a.txt`);
    const historyRes = await fetch(`${base}/api/repos/nope/history?file=a.txt`);
    const committedRes = await fetch(`${base}/api/repos/nope/committed`);
    const searchRes = await fetch(`${base}/api/repos/nope/search?q=x`);
    for (const res of [blameRes, historyRes, committedRes, searchRes]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-koa patch/shelf/console/ignore 端点', () => {
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('patches 端点：GET 空 → create 工作区态 → apply 回工作区 → delete 往返均 200', async () => {
    const { repoId, repoPath } = registerRepo();
    const emptyRes = await fetch(`${base}/api/repos/${repoId}/patches`);
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ patches: [] });

    // create：工作区 diff 全量存档（返回刷新列表）
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    const createRes = await postJson(`/api/repos/${repoId}/patches/create`, { name: 'p1' });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { patches: Array<{ name: string; size: number; createdAtIso: string }> };
    expect(created.patches).toHaveLength(1);
    expect(created.patches[0]).toMatchObject({ name: 'p1', size: expect.any(Number) });
    expect(created.patches[0].createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // apply：先还原工作区再回放补丁（返回 RepoStatus）
    execFileSync('git', ['-C', repoPath, 'checkout', '--', 'a.txt']);
    expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('hello\n');
    const applyRes = await postJson(`/api/repos/${repoId}/patches/apply`, { name: 'p1' });
    expect(applyRes.status).toBe(200);
    const status = (await applyRes.json()) as { entries: Array<{ path: string; code: string }> };
    // porcelain v2 代码：index 干净、工作区修改 → '.M'
    expect(status.entries.find((e) => e.path === 'a.txt')?.code).toBe('.M');
    expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('hello\nworld\n');

    // delete：刷新列表清空
    const delRes = await postJson(`/api/repos/${repoId}/patches/delete`, { name: 'p1' });
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ patches: [] });
  });

  it('patches 端点：非法 name（zod 拒绝）与缺 name apply 均 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const badName = await postJson(`/api/repos/${repoId}/patches/create`, { name: '两 个 空 格' });
    const badApply = await postJson(`/api/repos/${repoId}/patches/apply`, {});
    for (const res of [badName, badApply]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('shelves 端点：GET 空 → save（含未跟踪）→ restore（回工作区）→ drop 往返均 200', async () => {
    const { repoId, repoPath } = registerRepo();
    const emptyRes = await fetch(`${base}/api/repos/${repoId}/shelves`);
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ shelves: [] });

    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    writeFileSync(join(repoPath, 'new.txt'), 'new\n');
    const saveRes = await postJson(`/api/repos/${repoId}/shelves`, { action: 'save', name: 'wip' });
    expect(saveRes.status).toBe(200);
    const saved = (await saveRes.json()) as { shelves: Array<{ name: string; untrackedCount: number }> };
    expect(saved.shelves).toHaveLength(1);
    expect(saved.shelves[0]).toMatchObject({ name: 'wip', untrackedCount: 1 });

    // restore：清理工作区后回放（tracked 补丁 + 未跟踪回拷），shelf 保留
    execFileSync('git', ['-C', repoPath, 'checkout', '--', 'a.txt']);
    rmSync(join(repoPath, 'new.txt'));
    const restoreRes = await postJson(`/api/repos/${repoId}/shelves`, { action: 'restore', name: 'wip' });
    expect(restoreRes.status).toBe(200);
    expect((((await restoreRes.json()) as { shelves: unknown[] }).shelves)).toHaveLength(1);
    expect(readFileSync(join(repoPath, 'a.txt'), 'utf8')).toBe('hello\nworld\n');
    expect(readFileSync(join(repoPath, 'new.txt'), 'utf8')).toBe('new\n');

    const dropRes = await postJson(`/api/repos/${repoId}/shelves`, { action: 'drop', name: 'wip' });
    expect(dropRes.status).toBe(200);
    expect(await dropRes.json()).toEqual({ shelves: [] });
  });

  it('shelves 端点：save 重名 → 400 INVALID_QUERY；restore 不存在 → 400 INVALID_REF；未知 action（zod 拒绝）→ 400', async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    const post = (body: unknown) => postJson(`/api/repos/${repoId}/shelves`, body);
    const first = await post({ action: 'save', name: 'dup' });
    expect(first.status).toBe(200);
    const dup = await post({ action: 'save', name: 'dup' });
    expect(dup.status).toBe(400);
    expect(await dup.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const ghost = await post({ action: 'restore', name: 'ghost' });
    expect(ghost.status).toBe(400);
    expect(await ghost.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
    const unknown = await post({ action: 'apply', name: 'x' });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('console 端点：真实调用链制造 git 操作后 GET 返回 200 且 id 从 1 递增、args 为数组', async () => {
    const { repoId } = registerRepo();
    // 先经 status 端点产生真实 git 记录（runGit 按 resolveRepo 产出的同串 cwd 键控）
    await fetch(`${base}/api/repos/${repoId}/status`);
    const res = await fetch(`${base}/api/repos/${repoId}/console`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; args: string[]; exitCode: number; durationMs: number; stderrTail: string; atIso: string }>;
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.map((e) => e.id)).toEqual(body.map((_e, i) => i + 1));
    const last = body[body.length - 1];
    expect(last.args).toBeInstanceOf(Array);
    expect(last.args[0]).toBe('--no-pager'); // git 调用固定注入
    expect(last.args).toContain('status');
    expect(typeof last.exitCode).toBe('number');
    expect(typeof last.durationMs).toBe('number');
    expect(typeof last.stderrTail).toBe('string');
    expect(typeof last.atIso).toBe('string');
  });

  it('console 端点：limit 越界（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/console?limit=501`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('ignore 端点：GET 读空 → PUT 整写 → add 幂等追加 → templates 三模板，均 200', async () => {
    const { repoId } = registerRepo();
    const getRes = await fetch(`${base}/api/repos/${repoId}/ignore`);
    expect(getRes.status).toBe(200);
    const read = (await getRes.json()) as { gitignore: string; exclude: string };
    expect(read.gitignore).toBe('');
    expect(typeof read.exclude).toBe('string');

    const putRes = await fetch(`${base}/api/repos/${repoId}/ignore`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'gitignore', content: 'node_modules/\n' }),
    });
    expect(putRes.status).toBe(200);
    expect(((await putRes.json()) as { gitignore: string }).gitignore).toBe('node_modules/\n');

    // add：追加 /<path>；重复追加幂等（行 trim 判等不重复）
    const addRes = await postJson(`/api/repos/${repoId}/ignore/add`, { path: 'dist' });
    expect(addRes.status).toBe(200);
    expect(((await addRes.json()) as { gitignore: string }).gitignore).toBe('node_modules/\n/dist\n');
    const againRes = await postJson(`/api/repos/${repoId}/ignore/add`, { path: 'dist' });
    expect(againRes.status).toBe(200);
    expect(((await againRes.json()) as { gitignore: string }).gitignore).toBe('node_modules/\n/dist\n');

    const tplRes = await fetch(`${base}/api/repos/${repoId}/ignore/templates`);
    expect(tplRes.status).toBe(200);
    const templates = (await tplRes.json()) as Array<{ id: string; name: string }>;
    expect(templates.map((t) => t.id)).toEqual(['node', 'python', 'general']);
    expect(templates.map((t) => t.name)).toEqual(['Node.js', 'Python', '通用']);
  });

  it('ignore 端点：PUT 非法 target（zod 拒绝）与 add 缺 path 均 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const putRes = await fetch(`${base}/api/repos/${repoId}/ignore`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'user', content: 'x' }),
    });
    const addRes = await postJson(`/api/repos/${repoId}/ignore/add`, {});
    for (const res of [putRes, addRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：patches/shelves/console/ignore 及其子端点返回 404 REPO_NOT_FOUND', async () => {
    const cases = [
      fetch(`${base}/api/repos/nope/patches`),
      postJson('/api/repos/nope/patches/create', { name: 'p' }),
      postJson('/api/repos/nope/patches/apply', { name: 'p' }),
      postJson('/api/repos/nope/patches/delete', { name: 'p' }),
      fetch(`${base}/api/repos/nope/shelves`),
      postJson('/api/repos/nope/shelves', { action: 'save', name: 'w' }),
      fetch(`${base}/api/repos/nope/console`),
      fetch(`${base}/api/repos/nope/ignore`),
      fetch(`${base}/api/repos/nope/ignore`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'gitignore', content: 'x' }),
      }),
      postJson('/api/repos/nope/ignore/add', { path: 'x' }),
      fetch(`${base}/api/repos/nope/ignore/templates`),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-koa GitHub PR 域端点', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/pull），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'ghp_route-test-token-1234567890';
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + github.com 远程（origin = https://github.com/acme/demo.git） */
  const githubRepo = (): { repoId: string; repoPath: string } => {
    const rig = registerRepo();
    execFileSync('git', ['-C', rig.repoPath, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
    return rig;
  };
  /** 配置 github.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  /**
   * mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止）。
   * 本测试文件自身的 HTTP 夹具也走全局 fetch → api.github.com 之外一律转真实 fetch（先捕获再 stub）。
   */
  const mockGithubFetch = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const realFetch = globalThis.fetch;
    const queue = [...responses];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/')) {
        const r = queue.shift();
        if (r === undefined) throw new Error(`未预期的 GitHub API 调用：${url}`);
        return new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** mock 调用过滤：只计 GitHub API 命中（本测试文件自身夹具请求也过同一 stub） */
  const githubCalls = (mock: ReturnType<typeof vi.fn>): unknown[][] =>
    mock.mock.calls.filter((c) => String(c[0]).startsWith('https://api.github.com/'));
  /** GitHub API pull JSON 夹具（toPrSummary 所需字段齐） */
  const pullFixture = (overrides: Record<string, unknown> = {}) => ({
    number: 12,
    title: 'Fix thing',
    user: { login: 'alice' },
    state: 'open',
    merged: false,
    base: { ref: 'main' },
    head: { ref: 'feature/fix' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T03:04:05Z',
    ...overrides,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 端点：无远程 → 200 {detected:false}（三态之一）', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/github/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const { repoId } = githubRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/github/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://github.com/acme/demo.git' },
    });
    expect((body as { account?: string }).account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await fetch(`${base}/api/repos/${repoId}/github/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ detected: true, account: 'me' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/github/status`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('prs 端点：state 缺省 open 透传（URL 与 token 注入）', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({ json: [pullFixture()] });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prs: unknown[] }).prs).toHaveLength(1);
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls?state=open');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('prs 端点：state=all 透传 query', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({ json: [] });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs?state=all`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prs: [] });
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls?state=all');
  });

  it('prs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs?state=merge`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('detail 端点：mock fetch 断言 URL 与映射（reviewDecision）', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({
      json: {
        ...pullFixture({ number: 7, title: 'Detail' }),
        body: 'Description',
        mergeable: true,
        review_decision: 'APPROVED',
        comments: 3,
        additions: 40,
        deletions: 12,
      },
    });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      number: 7,
      title: 'Detail',
      author: 'alice',
      body: 'Description',
      mergeable: true,
      reviewDecision: 'APPROVED',
      commentsCount: 3,
      additions: 40,
      deletions: 12,
    });
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7');
  });

  it('path 参数：number=0 / number=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    for (const bad of ['0', 'abc']) {
      const res = await fetch(`${base}/api/repos/${repoId}/github/prs/${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('timeline 端点：comments + reviews 两请求 URL 与合并升序', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch(
      { json: [{ id: 5, user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' }] },
      {
        json: [{ id: 12, user: { login: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'needs work', state: 'CHANGES_REQUESTED' }],
      },
    );
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7/timeline`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
        {
          id: 1000000012,
          author: 'carol',
          atIso: '2026-01-02T00:00:00Z',
          body: 'needs work',
          kind: 'review',
          reviewState: 'CHANGES_REQUESTED',
        },
      ],
    });
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect((githubCalls(mock)[1] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
  });

  it('files 端点：mock fetch 断言 URL 与映射（patch 缺省 → 空串）', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({
      json: [
        { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { filename: 'new.ts', status: 'added', additions: 5, deletions: 0 },
      ],
    });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7/files`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 5, deletions: 0, patch: '' },
      ],
    });
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/files');
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch(
      { status: 201, json: { id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/comments`, { body: 'new comment' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/review`, { event: 'APPROVED' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('review 端点：POST 载荷 {event, body} 与刷新详情回包', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch(
      {
        status: 201,
        json: { id: 21, state: 'APPROVED', user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'looks good' },
      },
      {
        json: {
          ...pullFixture({ number: 7 }),
          body: 'b',
          mergeable: true,
          review_decision: 'APPROVED',
          comments: 1,
          additions: 1,
          deletions: 0,
        },
      },
    );
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/review`, { event: 'APPROVE', body: 'looks good' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewDecision: string }).reviewDecision).toBe('APPROVED');
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ event: 'APPROVE', body: 'looks good' }));
  });

  it('merge 端点：method 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/merge`, { method: 'ff' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('merge 端点：POST {merge_method} 载荷与回包', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({ status: 200, json: { merged: true, message: 'Pull Request successfully merged' } });
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/merge`, { method: 'squash' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Pull Request successfully merged' });
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/merge');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ merge_method: 'squash' }));
  });

  it('checkout 端点：真实裸仓库 refs/pull/7/head → pr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-koa-github-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-koa-github-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'pr.txt'), 'pr-7 content');
    execFileSync('git', ['-C', other, 'add', 'pr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'pr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head']);
    const prHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/pull/7/head'], { encoding: 'utf8' }).trim();

    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7/checkout`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'pr-7' });
    expect(execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('pr-7');
    expect(execFileSync('git', ['-C', repoPath, 'rev-parse', 'refs/heads/pr-7'], { encoding: 'utf8' }).trim()).toBe(prHash);
    expect(execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：github 全部 9 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases = [
      fetch(`${base}/api/repos/nope/github/status`),
      fetch(`${base}/api/repos/nope/github/prs`),
      fetch(`${base}/api/repos/nope/github/prs/7`),
      fetch(`${base}/api/repos/nope/github/prs/7/timeline`),
      postJson('/api/repos/nope/github/prs/7/comments', { body: 'x' }),
      fetch(`${base}/api/repos/nope/github/prs/7/files`),
      postJson('/api/repos/nope/github/prs/7/review', { event: 'APPROVE' }),
      postJson('/api/repos/nope/github/prs/7/merge', { method: 'merge' }),
      fetch(`${base}/api/repos/nope/github/prs/7/checkout`, { method: 'POST' }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-koa GitLab MR 域端点', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/merge-requests），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'glpat-route-test-token-1234567890';
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + gitlab.com 远程（origin = https://gitlab.com/acme/demo.git） */
  const gitlabRepo = (): { repoId: string; repoPath: string } => {
    const rig = registerRepo();
    execFileSync('git', ['-C', rig.repoPath, 'remote', 'add', 'origin', 'https://gitlab.com/acme/demo.git']);
    return rig;
  };
  /** 配置 gitlab.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  /**
   * mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止）。
   * 本测试文件自身的 HTTP 夹具也走全局 fetch → gitlab.com api 之外一律转真实 fetch（先捕获再 stub）。
   */
  const mockGitlabFetch = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const realFetch = globalThis.fetch;
    const queue = [...responses];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://gitlab.com/api/v4/')) {
        const r = queue.shift();
        if (r === undefined) throw new Error(`未预期的 GitLab API 调用：${url}`);
        return new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** mock 调用过滤：只计 GitLab API 命中（本测试文件自身夹具请求也过同一 stub） */
  const gitlabCalls = (mock: ReturnType<typeof vi.fn>): unknown[][] =>
    mock.mock.calls.filter((c) => String(c[0]).startsWith('https://gitlab.com/api/v4/'));
  /** GitLab API project 基址：owner 全路径（含子组）encodeURIComponent 后为 acme%2Fdemo */
  const MR_BASE = 'https://gitlab.com/api/v4/projects/acme%2Fdemo';
  /** GitLab MR JSON 夹具（toMrSummary 所需字段齐） */
  const mrFixture = (overrides: Record<string, unknown> = {}) => ({
    iid: 12,
    title: 'Fix thing',
    author: { username: 'alice' },
    state: 'opened',
    source_branch: 'feature/fix',
    target_branch: 'main',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T03:04:05Z',
    ...overrides,
  });
  /** MR 详情夹具（toMrDetail 所需字段齐：merge_status/user_notes_count） */
  const mrDetailFixture = (overrides: Record<string, unknown> = {}) => ({
    iid: 7,
    title: 'Detail',
    author: { username: 'carol' },
    state: 'opened',
    source_branch: 'fix',
    target_branch: 'main',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    description: 'Description',
    merge_status: 'can_be_merged',
    user_notes_count: 3,
    ...overrides,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 端点：无远程 → 200 {detected:false}（三态之一）', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const { repoId } = gitlabRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://gitlab.com/acme/demo.git' },
    });
    expect((body as { account?: string }).account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ detected: true, account: 'me' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/gitlab/status`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('mrs 端点：state 缺省 opened 透传（URL 与 PRIVATE-TOKEN 注入）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({ json: [mrFixture()] });
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mrs: [
        {
          iid: 12,
          title: 'Fix thing',
          author: 'alice',
          state: 'opened',
          sourceBranch: 'feature/fix',
          targetBranch: 'main',
          createdAtIso: '2026-01-01T00:00:00Z',
          updatedAtIso: '2026-01-02T03:04:05Z',
        },
      ],
    });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests?state=opened`);
    expect(init.headers).toMatchObject({ 'PRIVATE-TOKEN': TOKEN });
  });

  it('mrs 端点：state=merged 透传 query', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({ json: [] });
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs?state=merged`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mrs: [] });
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests?state=merged`);
  });

  it('mrs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs?state=merge`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('create 端点：POST 载荷（sourceBranch/targetBranch/title/description）与重查 detail 回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      {
        status: 201,
        json: {
          iid: 11,
          title: 'New MR',
          author: { username: 'me' },
          state: 'opened',
          source_branch: 'feature',
          target_branch: 'main',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          description: 'D',
        },
      },
      {
        json: {
          iid: 11,
          title: 'New MR',
          author: { username: 'me' },
          state: 'opened',
          source_branch: 'feature',
          target_branch: 'main',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          description: 'D',
          merge_status: 'checking',
          user_notes_count: 0,
        },
      },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs`, {
      sourceBranch: 'feature',
      targetBranch: 'main',
      title: 'New MR',
      description: 'D',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ iid: 11, title: 'New MR', body: 'D' });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ source_branch: 'feature', target_branch: 'main', title: 'New MR', description: 'D' }),
    );
    // 重查 detail 走 GET /merge_requests/11（create 返回后）。
    expect((gitlabCalls(mock)[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/11`);
  });

  it('create 端点：缺 targetBranch（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs`, { sourceBranch: 'feature', title: 'No target' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('detail 端点：mock fetch 断言 URL 序列（MR + 尽力 reviews）与映射', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      iid: 7,
      title: 'Detail',
      author: 'carol',
      state: 'opened',
      sourceBranch: 'fix',
      targetBranch: 'main',
      createdAtIso: '2026-01-01T00:00:00Z',
      updatedAtIso: '2026-01-02T00:00:00Z',
      body: 'Description',
      mergeable: true,
      reviewState: 'APPROVED',
      commentsCount: 3,
      additions: 0,
      deletions: 0,
    });
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7`);
    expect((gitlabCalls(mock)[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('path 参数：iid=0 / iid=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    for (const bad of ['0', 'abc']) {
      const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('timeline 端点：notes + reviews 两请求 URL 与合并升序（review id 移位）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      {
        json: [
          { id: 5, author: { username: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' },
          { id: 6, author: { username: 'bob' }, created_at: '2026-01-03T00:00:00Z', body: 'comment 3' },
        ],
      },
      {
        json: [
          { id: 12, state: 'approved', author: { username: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' },
          { id: 13, state: 'rejected', author: { username: 'dave' }, created_at: '2026-01-04T00:00:00Z', body: 'needs work' },
          { id: 14, state: 'commented', author: { username: 'erin' }, created_at: '2026-01-05T00:00:00Z', body: 'hmm' },
        ],
      },
    );
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7/timeline`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
        { id: 1000000012, author: 'carol', atIso: '2026-01-02T00:00:00Z', body: 'lgtm', kind: 'review', reviewState: 'APPROVED' },
        { id: 6, author: 'bob', atIso: '2026-01-03T00:00:00Z', body: 'comment 3', kind: 'comment' },
        { id: 1000000013, author: 'dave', atIso: '2026-01-04T00:00:00Z', body: 'needs work', kind: 'review', reviewState: 'CHANGES_REQUESTED' },
        { id: 1000000014, author: 'erin', atIso: '2026-01-05T00:00:00Z', body: 'hmm', kind: 'review', reviewState: 'COMMENTED' },
      ],
    });
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect((gitlabCalls(mock)[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('files 端点：mock fetch 断言 URL 与映射（new_path ?? old_path；旗标；diff 缺省 → 空串）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({
      json: [
        { new_path: 'a.ts', old_path: 'a.ts', diff: '@@ -1 +1 @@', new_file: false, deleted_file: false },
        { new_path: 'new.ts', old_path: null, new_file: true, deleted_file: false },
        { new_path: 'renamed.ts', old_path: 'old.ts', renamed_file: true, new_file: true, deleted_file: false },
        { new_path: null, old_path: 'del.ts', deleted_file: true, new_file: false },
        { new_path: 'm.ts', old_path: 'm.ts', new_file: false, deleted_file: false, renamed_file: false, diff: null },
      ],
    });
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7/files`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 0, deletions: 0, diff: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 0, deletions: 0, diff: '' },
        { path: 'renamed.ts', status: 'renamed', additions: 0, deletions: 0, diff: '' },
        { path: 'del.ts', status: 'removed', additions: 0, deletions: 0, diff: '' },
        { path: 'm.ts', status: 'modified', additions: 0, deletions: 0, diff: '' },
      ],
    });
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/changes`);
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包（note + notes + reviews 三请求）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 201, json: { id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/comments`, { body: 'new comment' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'APPROVED' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('review 端点：APPROVE → POST .../approve（无 body）与刷新详情回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 200, json: { id: 1, state: 'approved' } },
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'APPROVE', body: 'looks good' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('APPROVED');
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/approve`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('review 端点：REQUEST_CHANGES → POST .../reviews {state:rejected} 与刷新详情回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 201, json: { id: 2, state: 'rejected' } },
      { json: mrDetailFixture({ user_notes_count: 0 }) },
      {
        json: [{ id: 21, state: 'rejected', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'nope' }],
      },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'REQUEST_CHANGES', body: 'nope' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('CHANGES_REQUESTED');
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/reviews`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ state: 'rejected' }));
  });

  it('review 端点：COMMENT → POST .../notes {body} 与刷新详情回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 201, json: { id: 3, body: 'need fix', author: { username: 'me' } } },
      { json: mrDetailFixture({ user_notes_count: 1 }) },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'COMMENT', body: 'need fix' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { commentsCount: number }).commentsCount).toBe(1);
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'need fix' }));
  });

  it('merge 端点：squash 类型非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/merge`, { squash: 'yes' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('merge 端点：PUT {squash:true} 载荷与回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({ status: 200, json: { state: 'merged', message: 'Merge request merged successfully' } });
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/merge`, { squash: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Merge request merged successfully' });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/merge`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ squash: true }));
  });

  it('checkout 端点：真实裸仓库 refs/merge-requests/7/head → mr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-koa-gitlab-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-koa-gitlab-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'mr.txt'), 'mr-7 content');
    execFileSync('git', ['-C', other, 'add', 'mr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'mr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/merge-requests/7/head']);
    const mrHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/merge-requests/7/head'], { encoding: 'utf8' }).trim();

    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7/checkout`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'mr-7' });
    expect(execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('mr-7');
    expect(execFileSync('git', ['-C', repoPath, 'rev-parse', 'refs/heads/mr-7'], { encoding: 'utf8' }).trim()).toBe(mrHash);
    expect(execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：gitlab 全部 10 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases = [
      fetch(`${base}/api/repos/nope/gitlab/status`),
      fetch(`${base}/api/repos/nope/gitlab/mrs`),
      postJson('/api/repos/nope/gitlab/mrs', { sourceBranch: 'a', targetBranch: 'b', title: 't' }),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7`),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7/timeline`),
      postJson('/api/repos/nope/gitlab/mrs/7/comments', { body: 'x' }),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7/files`),
      postJson('/api/repos/nope/gitlab/mrs/7/review', { event: 'APPROVE' }),
      postJson('/api/repos/nope/gitlab/mrs/7/merge', { squash: true }),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7/checkout`, { method: 'POST' }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-koa worktree/submodule 域端点', () => {
  /** 子模块装置用例 git 进程密集（content 仓库 + bare + submodule add + 多次 status），统一放宽用例超时（终审：120→180s） */
  const RIG_TIMEOUT = 180000;
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const git = (repo: string, args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  /** 主仓库旁的副工作树路径（sibling） */
  const siblingPath = (repo: string, suffix: string) => join(dirname(repo), basename(repo) + suffix);
  /** 路径等价比较：git 输出 realpath 长形式，mkdtemp 可能返回 8.3 短形式——OS 级归一 */
  const samePath = (a: string, b: string) => realpathSync.native(a) === realpathSync.native(b);

  it('worktrees 列表端点：初始返回单条主工作树（branch/head/detached）', async () => {
    const { repoId, repoPath } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/worktrees`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worktrees).toHaveLength(1);
    const main = body.worktrees[0];
    // 终审 I1：主工作树 path 字符串全等于注册仓库路径（保真 repoPath，含 8.3 短形式）
    expect(main.path).toBe(repoPath);
    expect(main.branch).toBe(git(repoPath, ['symbolic-ref', '--short', 'HEAD']));
    expect(main.detached).toBe(false);
    expect(main.head).toBe(git(repoPath, ['rev-parse', 'HEAD']));
  });

  it('create 端点 newBranch：200 刷新列表含主+副（副 branch/head 完整）', async () => {
    const { repoId, repoPath } = registerRepo();
    const wtPath = siblingPath(repoPath, '-wt-new');
    const res = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath, newBranch: 'feat-route' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worktrees).toHaveLength(2);
    const wt = body.worktrees.find((w: { path: string }) => samePath(w.path, wtPath));
    expect(wt).toMatchObject({ branch: 'feat-route', detached: false });
    expect(wt.head).toBe(git(repoPath, ['rev-parse', 'refs/heads/feat-route']));
  });

  it('create 端点 branch 挂接既有分支', async () => {
    const { repoId, repoPath } = registerRepo();
    git(repoPath, ['branch', 'feat']);
    const wtPath = siblingPath(repoPath, '-wt-attach');
    const res = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath, branch: 'feat' });
    expect(res.status).toBe(200);
    const body = await res.json();
    const wt = body.worktrees.find((w: { path: string }) => samePath(w.path, wtPath));
    expect(wt).toMatchObject({ branch: 'feat', detached: false });
  });

  it('create 端点互斥预检：都缺/同给 → 400 INVALID_QUERY；分支不存在 → 400 INVALID_REF', async () => {
    const { repoId, repoPath } = registerRepo();
    const wtPath = siblingPath(repoPath, '-wt-excl');
    const missing = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const both = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath, branch: 'a', newBranch: 'b' });
    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const noBranch = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath, branch: 'nope' });
    expect(noBranch.status).toBe(400);
    expect(await noBranch.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('create 端点 zod 反例：path 空 → 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await postJson(`/api/repos/${repoId}/worktrees`, { path: '', newBranch: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('remove 端点：创建后移除 → 200 列表复原；已不存在 → 400 INVALID_QUERY', async () => {
    const { repoId, repoPath } = registerRepo();
    const wtPath = siblingPath(repoPath, '-wt-rm');
    const created = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath, newBranch: 'rm-b' });
    expect((await created.json()).worktrees).toHaveLength(2);

    const res = await postJson(`/api/repos/${repoId}/worktrees/remove`, { path: wtPath });
    expect(res.status).toBe(200);
    expect((await res.json()).worktrees).toHaveLength(1);

    const gone = await postJson(`/api/repos/${repoId}/worktrees/remove`, { path: wtPath });
    expect(gone.status).toBe(400);
    expect(await gone.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('prune 端点：目录缺失的陈旧条目被清理 → 200 列表复原', async () => {
    const { repoId, repoPath } = registerRepo();
    const wtPath = siblingPath(repoPath, '-wt-stale');
    const created = await postJson(`/api/repos/${repoId}/worktrees`, { path: wtPath, newBranch: 'stale-b' });
    expect((await created.json()).worktrees).toHaveLength(2);
    rmSync(wtPath, { recursive: true, force: true });

    const res = await fetch(`${base}/api/repos/${repoId}/worktrees/prune`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).worktrees).toHaveLength(1);
  });

  it('submodules 列表/更新往返：add 后 checked-out → 检出旧提交 different-commit → update 复原', { timeout: RIG_TIMEOUT }, async () => {
    const content = tmpDir('rebased-web-koa-subcontent-');
    git(content, ['init', '-q']);
    git(content, ['config', 'user.email', 'test@example.com']);
    git(content, ['config', 'user.name', 'Test User']);
    writeFileSync(join(content, 'c.txt'), 'c1');
    git(content, ['add', 'c.txt']);
    git(content, ['commit', '-q', '-m', 'A']);
    const aSha = git(content, ['rev-parse', 'HEAD']);
    writeFileSync(join(content, 'c.txt'), 'c2');
    git(content, ['commit', '-q', '-am', 'B']);
    const bSha = git(content, ['rev-parse', 'HEAD']);
    const bare = content + '.git';
    git(content, ['clone', '--bare', '-q', '.', bare]);
    const bareUrl = bare.replace(/\\/g, '/');
    const { repoId, repoPath } = registerRepo();
    git(repoPath, ['-c', 'protocol.file.allow=always', 'submodule', 'add', bareUrl, 'sub']);
    git(repoPath, ['add', '-A']);
    git(repoPath, ['commit', '-q', '-m', 'addsub']);
    const gitlinkSha = git(repoPath, ['rev-parse', 'HEAD:sub']);
    expect(gitlinkSha).toBe(bSha);

    // 初始：submodule add 后即 checked-out（commitSha=gitlink sha）
    let res = await fetch(`${base}/api/repos/${repoId}/submodules`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'checked-out', commitSha: bSha }],
    });

    // 子模块工作树检出旧提交 A → different-commit
    git(join(repoPath, 'sub'), ['checkout', '-q', aSha]);
    res = await fetch(`${base}/api/repos/${repoId}/submodules`);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'different-commit', commitSha: aSha }],
    });

    // update 复原 checked-out（无网络：对象在本仓库）；CLI 复核实际检出
    res = await postJson(`/api/repos/${repoId}/submodules/update`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'checked-out', commitSha: bSha }],
    });
    expect(git(join(repoPath, 'sub'), ['rev-parse', 'HEAD'])).toBe(bSha);
  });

  it('未注册 repoId：worktree/submodule 全部 6 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases = [
      fetch(`${base}/api/repos/nope/worktrees`),
      postJson('/api/repos/nope/worktrees', { path: 'C:/wt', newBranch: 'x' }),
      postJson('/api/repos/nope/worktrees/remove', { path: 'C:/wt' }),
      fetch(`${base}/api/repos/nope/worktrees/prune`, { method: 'POST' }),
      fetch(`${base}/api/repos/nope/submodules`),
      postJson('/api/repos/nope/submodules/update', {}),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
