/**
 * web-koa merge/conflicts 端点集成测试（拆分自 app.test.ts）。
 * 职责：merge（冲突态、continue、参数校验）、conflicts（列表/三版本 contents/resolve）、
 * stashes（save/apply/drop/pop）、changelists（default/create/move）端点的响应形状与错误映射断言。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空注册表）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDirs, makeConflictScenario, registerRepo, startServer, tmpDir } from './testing/integration';

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
