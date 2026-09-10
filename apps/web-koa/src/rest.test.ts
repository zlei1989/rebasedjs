/**
 * web-koa REST 端点集成测试（拆分自 app.test.ts）。
 * 职责：REST 端点（status/open/init/clone/delete/home-dir/log/diff/settings/config/gpg-config/
 * operation/staging/diff-patch/commit/amend/branches/checkout/checkout-rebase/reset 等）的响应形状、
 * 统一错误映射（{error:{code,message}} + 状态码）断言。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）+ beforeAll/afterAll 起停；每用例独立
 * REBASED_CONFIG_DIR（空注册表）；afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDirs, makeLocalCommit, registerRepo, startServer, tmpDir } from './testing/integration';

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

  it('diff/branch-working 端点：分支与工作树一致 → 空清单；ghost → 400 INVALID_REF', async () => {
    const { repoId, repoPath } = registerRepo();
    const main = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const okRes = await fetch(`${base}/api/repos/${repoId}/diff/branch-working?branch=${encodeURIComponent(main)}`);
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ branch: main, files: [] });

    const ghostRes = await fetch(`${base}/api/repos/${repoId}/diff/branch-working?branch=ghost`);
    expect(ghostRes.status).toBe(400);
    expect(await ghostRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('settings 端点：GET 返回默认设置，PUT 局部更新后回读生效', async () => {
    const beforeRes = await fetch(`${base}/api/settings`);
    expect(beforeRes.status).toBe(200);
    expect(await beforeRes.json()).toEqual({ logInEditor: true, recentRepoIds: [], protectedBranchPatterns: [], theme: 'dark' });

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

  it('settings 端点：PUT 保护分支模式（合法/非法正则）→ 200/400', async () => {
    const okRes = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protectedBranchPatterns: ['^main$', '^release/'] }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ protectedBranchPatterns: ['^main$', '^release/'] });

    const badRes = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protectedBranchPatterns: ['(['] }),
    });
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('settings/git-executable 端点：200 GitExecutableInfo（本机 PATH git 可执行 → ok 且版本可解析）', async () => {
    const res = await fetch(`${base}/api/settings/git-executable`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exec: string; version: string | null; ok: boolean };
    expect(body.exec).toBe('git');
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^git version \S+/);
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

  it('gpg-config 端点：GET 返回视图（gpg 不可用 → keys 空）；PUT 写两键并复核；enabled 无 key → 400', { timeout: 120000 }, async () => {
    const { repoId, repoPath } = registerRepo();
    execFileSync('git', ['-C', repoPath, 'config', '--local', 'gpg.program', 'Z:\\no-such-dir\\gpg.exe']);
    const put = (body: unknown) =>
      fetch(`${base}/api/repos/${repoId}/settings/gpg-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const getRes = await fetch(`${base}/api/repos/${repoId}/settings/gpg-config`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ enabled: false, key: null, keys: [] });

    // enabled=true + key → 写 commit.gpgsign/user.signingkey（仓库级）并返回刷新视图
    const KEY = 'A'.repeat(16);
    const putRes = await put({ enabled: true, key: KEY });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toMatchObject({ enabled: true, key: KEY });
    expect(
      execFileSync('git', ['-C', repoPath, 'config', '--local', '--get', 'commit.gpgsign'], { encoding: 'utf8' }).trim(),
    ).toBe('true');

    // enabled=true 无 key → 400（schema refine）
    const badRes = await put({ enabled: true });
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
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

  it('commit/crlf-warning 端点：暂存 CRLF 文件（无属性覆盖）→ 200 {warning:true,files}；暂存区空 → 200 {warning:false}', async () => {
    const { repoId, repoPath } = registerRepo();
    const url = `${base}/api/repos/${repoId}/commit/crlf-warning`;

    // 空暂存 → false
    const cleanRes = await fetch(url);
    expect(cleanRes.status).toBe(200);
    const clean = (await cleanRes.json()) as { warning: boolean; files: string[] };
    expect(clean.warning).toBe(false);

    // 暂存 CRLF 内容文件 → Windows 平台 true 且列涉事文件（GitCrlfProblemsDetector 语义）
    // 本机系统 gitconfig 可能默认 core.autocrlf=true（Git for Windows），本地覆盖为 false 以走检测主路径
    execFileSync('git', ['-C', repoPath, 'config', 'core.autocrlf', 'false']);
    writeFileSync(join(repoPath, 'crlf.txt'), 'line1\r\n');
    execFileSync('git', ['-C', repoPath, 'add', 'crlf.txt']);
    const warnRes = await fetch(url);
    expect(warnRes.status).toBe(200);
    const warn = (await warnRes.json()) as { warning: boolean; files: string[] };
    if (process.platform === 'win32') {
      expect(warn.warning).toBe(true);
      expect(warn.files).toContain('crlf.txt');
    } else {
      expect(warn.warning).toBe(false);
    }
  });

  it('branches 端点：GET 返回 200 且列表含当前分支（current=true）', async () => {
    const { repoId, repoPath } = registerRepo();
    const current = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = await fetch(`${base}/api/repos/${repoId}/branches`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branches: Array<{ name: string; current: boolean }>; recent: string[] };
    const entry = body.branches.find((b) => b.name === current);
    expect(entry).toBeDefined();
    expect(entry!.current).toBe(true);
    // 最近检出组（reflog）：初始无 checkout 记录 → 空数组
    expect(body.recent).toEqual([]);
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

  it('checkout-rebase 端点：目标分支检出并变基到当前 → 200 success 且当前分支切换；当前分支/不存在 → 400', { timeout: 120000 }, async () => {
    const { repoId, repoPath } = registerRepo();
    const main = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repoPath, 'checkout', '-q', '-b', 'dev']);
    makeLocalCommit(repoPath, 'dev.txt', 'dev\n', 'dev');
    execFileSync('git', ['-C', repoPath, 'checkout', '-q', main]);
    makeLocalCommit(repoPath, 'main.txt', 'main\n', 'main');
    const jsonPost = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const res = await jsonPost(`/api/repos/${repoId}/checkout-rebase`, { branch: 'dev' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('dev');
    expect(execFileSync('git', ['-C', repoPath, 'show', 'HEAD:main.txt'], { encoding: 'utf8' })).toBe('main\n');

    // 目标为当前分支 → INVALID_QUERY；分支不存在 → INVALID_REF
    const curRes = await jsonPost(`/api/repos/${repoId}/checkout-rebase`, { branch: 'dev' });
    expect(curRes.status).toBe(400);
    expect(await curRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await jsonPost(`/api/repos/${repoId}/checkout-rebase`, { branch: 'ghost' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('checkout-update 端点：本地分支（已设上游）检出并更新 → 200 success 且分支切换；无上游/当前 → 400', { timeout: 120000 }, async () => {
    const { repoId, repoPath } = registerRepo();
    // 裸远程 rig：为 dev 建立远程跟踪上游，再回到默认分支；对端先推进 dev（制造更新内容）
    const main = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const bare = tmpDir('rebased-web-koa-checkout-update-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', main]);
    execFileSync('git', ['-C', repoPath, 'checkout', '-q', '-b', 'dev']);
    execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', 'dev']);
    execFileSync('git', ['-C', repoPath, 'checkout', '-q', main]);
    const other = tmpDir('rebased-web-koa-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 't@t.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 't']);
    writeFileSync(join(other, 'remote.txt'), 'remote\n');
    execFileSync('git', ['-C', other, 'add', 'remote.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'remote dev']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:dev']);
    const jsonPost = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const res = await jsonPost(`/api/repos/${repoId}/checkout-update`, { branch: 'dev' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('dev');
    expect(execFileSync('git', ['-C', repoPath, 'show', 'HEAD:remote.txt'], { encoding: 'utf8' })).toBe('remote\n');

    // 当前分支 → INVALID_QUERY；不存在 → INVALID_REF
    const curRes = await jsonPost(`/api/repos/${repoId}/checkout-update`, { branch: 'dev' });
    expect(curRes.status).toBe(400);
    expect(await curRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await jsonPost(`/api/repos/${repoId}/checkout-update`, { branch: 'ghost' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
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
