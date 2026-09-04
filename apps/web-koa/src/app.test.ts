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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
  execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repoId, repoPath, bare, defaultBranch };
}

/** 第二 clone 对端：提交并推到裸仓库默认分支（制造远端新提交/分叉） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = tmpDir('rebased-web-koa-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
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
    expect(await getRes.json()).toEqual({ remotes: [] });

    const addRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' });
    expect(addRes.status).toBe(200);
    expect(await addRes.json()).toEqual({
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' }],
    });

    const setUrlRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'setUrl', name: 'origin', url: 'https://example.com/b.git' });
    expect(setUrlRes.status).toBe(200);
    expect(((await setUrlRes.json()) as { remotes: unknown[] }).remotes).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
    ]);

    const removeRes = await postJson(`/api/repos/${repoId}/remotes`, { action: 'remove', name: 'origin' });
    expect(removeRes.status).toBe(200);
    expect(await removeRes.json()).toEqual({ remotes: [] });
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

describe('web-koa blame/history/committed/search 端点', () => {
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

  it('committed 端点：默认全量 200 hasMore false；limit=1 分页 hasMore true；skip 越界空页', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'b.txt', 'two\n', 'second');
    makeLocalCommit(repoPath, 'c.txt', 'three\n', 'third');

    const fullRes = await fetch(`${base}/api/repos/${repoId}/committed`);
    expect(fullRes.status).toBe(200);
    const full = (await fullRes.json()) as { entries: Array<{ subject: string; author: string; files: Array<{ path: string; status: string }> }>; hasMore: boolean };
    expect(full.entries).toHaveLength(3);
    expect(full.hasMore).toBe(false);
    // 最新在前：entries[0] 为 third 提交且变更文件集正确
    expect(full.entries[0]).toMatchObject({ subject: 'third', author: 'Test User' });
    expect(full.entries[0].files).toEqual([{ path: 'c.txt', status: 'A' }]);
    expect(full.entries[1].subject).toBe('second');
    expect(full.entries[1].files).toEqual([{ path: 'b.txt', status: 'A' }]);

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
