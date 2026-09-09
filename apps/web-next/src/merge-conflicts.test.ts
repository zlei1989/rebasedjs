/**
 * web-next merge/conflicts 路由测试：合并冲突全流程、stashes、changelists。
 * 拆分自原 routes.test.ts 的 'web-next merge/conflicts 路由' describe：原单文件 194s 是测试提速瓶颈，
 * 按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as postMerge } from '../app/api/repos/[repoId]/merge/route';
import { POST as postMergeContinue } from '../app/api/repos/[repoId]/merge/continue/route';
import { GET as getConflicts } from '../app/api/repos/[repoId]/conflicts/route';
import { GET as getConflictContentsRoute } from '../app/api/repos/[repoId]/conflicts/contents/route';
import { POST as postResolveConflict } from '../app/api/repos/[repoId]/conflicts/resolve/route';
import { GET as getOperation } from '../app/api/repos/[repoId]/operation/route';
import { GET as getStashes, POST as postStashes } from '../app/api/repos/[repoId]/stashes/route';
import { GET as getChangelists, POST as postChangelists } from '../app/api/repos/[repoId]/changelists/route';
import { cleanupTestEnv, ctx, lastRepoPath, makeConflictScenario, registerRepo, setupTestEnv } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next merge/conflicts 路由', () => {
  it('冲突全流程：merge→conflicts 列表→contents 三版本→resolve theirs→continue→操作态清零', async () => {
    const repoId = registerRepo();
    makeConflictScenario();

    // POST merge：冲突合并 → 200 MergeOutcome{status:'conflicts'} 附带冲突列表
    const mergeRes = await postMerge(
      new Request(`http://localhost/api/repos/${repoId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: 'side' }),
      }),
      ctx(repoId),
    );
    expect(mergeRes.status).toBe(200);
    const outcome = await mergeRes.json();
    expect(outcome.status).toBe('conflicts');
    expect(outcome.conflicts).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);

    // GET conflicts：列出冲突路径
    const listRes = await getConflicts(new Request(`http://localhost/api/repos/${repoId}/conflicts`), ctx(repoId));
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

    // GET conflicts/contents：base/ours/theirs 三字段齐
    const contentsRes = await getConflictContentsRoute(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/contents?path=a.txt`),
      ctx(repoId),
    );
    expect(contentsRes.status).toBe(200);
    expect(await contentsRes.json()).toEqual({ path: 'a.txt', base: 'hello\n', ours: 'main\n', theirs: 'side\n' });

    // POST conflicts/resolve：theirs 采纳 → 列表变空
    const resolveRes = await postResolveConflict(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'theirs', path: 'a.txt' }),
      }),
      ctx(repoId),
    );
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toEqual({ conflicts: [] });

    // POST merge/continue（无请求体）：产合并提交 → 200 RepoStatus
    const continueRes = await postMergeContinue(
      new Request(`http://localhost/api/repos/${repoId}/merge/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opRes = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect(await opRes.json()).toEqual({ kind: 'none' });
  });

  it('merge 端点：空 branch 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postMerge(
      new Request(`http://localhost/api/repos/${repoId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: '' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('merge 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postMerge(
      new Request('http://localhost/api/repos/nope/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: 'side' }),
      }),
      ctx('nope'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('merge/continue 端点：无进行中合并返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postMergeContinue(
      new Request(`http://localhost/api/repos/${repoId}/merge/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('conflicts/contents 端点：缺 path 查询参数返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await getConflictContentsRoute(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/contents`),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('conflicts/resolve 端点：非法 strategy 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postResolveConflict(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'base', path: 'a.txt' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('stashes 端点：GET 返回 200 且空贮藏列表', async () => {
    const repoId = registerRepo();
    const res = await getStashes(new Request(`http://localhost/api/repos/${repoId}/stashes`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stashes: [] });
  });

  it('stashes 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getStashes(new Request('http://localhost/api/repos/nope/stashes'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('stashes 端点：save → apply → drop 往返均返回 200 刷新列表', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const post = (body: unknown) =>
      postStashes(
        new Request(`http://localhost/api/repos/${repoId}/stashes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ctx(repoId),
      );
    const saveRes = await post({ action: 'save', message: 'wip' });
    expect(saveRes.status).toBe(200);
    expect((await saveRes.json()).stashes).toHaveLength(1);
    const applyRes = await post({ action: 'apply', index: 0 });
    expect(applyRes.status).toBe(200);
    expect((await applyRes.json()).stashes).toHaveLength(1);
    const dropRes = await post({ action: 'drop', index: 0 });
    expect(dropRes.status).toBe(200);
    expect((await dropRes.json()).stashes).toHaveLength(0);
  });

  it('stashes 端点：pop 带负 index 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postStashes(
      new Request(`http://localhost/api/repos/${repoId}/stashes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pop', index: -1 }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('stashes 端点：无工作区改动 save 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postStashes(
      new Request(`http://localhost/api/repos/${repoId}/stashes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('changelists 端点：GET 返回 200 含默认列表', async () => {
    const repoId = registerRepo();
    const res = await getChangelists(new Request(`http://localhost/api/repos/${repoId}/changelists`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lists: [{ id: 'default', name: '默认', isDefault: true }],
      assignments: {},
    });
  });

  it('changelists 端点：POST create 返回 200 两列表', async () => {
    const repoId = registerRepo();
    const res = await postChangelists(
      new Request(`http://localhost/api/repos/${repoId}/changelists`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: '进行中' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lists).toHaveLength(2);
    expect(body.lists[0]).toEqual({ id: 'default', name: '默认', isDefault: true });
    expect(body.lists[1]).toMatchObject({ name: '进行中', isDefault: false });
  });

  it('changelists 端点：POST move 到不存在列表返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postChangelists(
      new Request(`http://localhost/api/repos/${repoId}/changelists`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'move', paths: ['a.txt'], targetId: 'no-such-list' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('changelists 端点：POST create 缺 name（zod 拒绝）返回 400', async () => {
    const repoId = registerRepo();
    const res = await postChangelists(
      new Request(`http://localhost/api/repos/${repoId}/changelists`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
  });

  it('changelists 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getChangelists(new Request('http://localhost/api/repos/nope/changelists'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});
