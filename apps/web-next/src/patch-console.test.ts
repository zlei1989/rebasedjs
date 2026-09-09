/**
 * web-next patch/shelf/console/ignore 路由测试：补丁存档/应用/删除、shelves、git 控制台记录与 .gitignore。
 * 拆分自原 routes.test.ts 的 'web-next patch/shelf/console/ignore 路由' describe：
 * 原单文件 194s 是测试提速瓶颈，按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getStatus } from '../app/api/repos/[repoId]/status/route';
import { GET as getPatches } from '../app/api/repos/[repoId]/patches/route';
import { POST as postPatchCreate } from '../app/api/repos/[repoId]/patches/create/route';
import { POST as postPatchApply } from '../app/api/repos/[repoId]/patches/apply/route';
import { POST as postPatchDelete } from '../app/api/repos/[repoId]/patches/delete/route';
import { GET as getShelves, POST as postShelves } from '../app/api/repos/[repoId]/shelves/route';
import { GET as getConsole } from '../app/api/repos/[repoId]/console/route';
import { GET as getIgnore, PUT as putIgnore } from '../app/api/repos/[repoId]/ignore/route';
import { POST as postIgnoreAdd } from '../app/api/repos/[repoId]/ignore/add/route';
import { GET as getIgnoreTemplates } from '../app/api/repos/[repoId]/ignore/templates/route';
import { cleanupTestEnv, ctx, lastRepoPath, registerRepo, setupTestEnv } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next patch/shelf/console/ignore 路由', () => {
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('patches 端点：GET 空 → create 工作区态 → apply 回工作区 → delete 往返均 200', async () => {
    const repoId = registerRepo();
    const emptyRes = await getPatches(new Request(`http://localhost/api/repos/${repoId}/patches`), ctx(repoId));
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ patches: [] });

    // create：工作区 diff 全量存档（返回刷新列表）
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const createRes = await postPatchCreate(jsonPost(`${repoId}/patches/create`, { name: 'p1' }), ctx(repoId));
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.patches).toHaveLength(1);
    expect(created.patches[0]).toMatchObject({ name: 'p1', size: expect.any(Number) });
    expect(created.patches[0].createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // apply：先还原工作区再回放补丁（返回 RepoStatus）
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '--', 'a.txt']);
    expect(readFileSync(join(lastRepoPath, 'a.txt'), 'utf8')).toBe('hello\n');
    const applyRes = await postPatchApply(jsonPost(`${repoId}/patches/apply`, { name: 'p1' }), ctx(repoId));
    expect(applyRes.status).toBe(200);
    const status = await applyRes.json();
    // porcelain v2 代码：index 干净、工作区修改 → '.M'
    expect(status.entries.find((e: { path: string }) => e.path === 'a.txt')?.code).toBe('.M');
    expect(readFileSync(join(lastRepoPath, 'a.txt'), 'utf8')).toBe('hello\nworld\n');

    // delete：刷新列表清空
    const delRes = await postPatchDelete(jsonPost(`${repoId}/patches/delete`, { name: 'p1' }), ctx(repoId));
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ patches: [] });
  });

  it('patches 端点：非法 name（zod 拒绝）与缺 name apply 均 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const badName = await postPatchCreate(jsonPost(`${repoId}/patches/create`, { name: '两 个 空 格' }), ctx(repoId));
    const badApply = await postPatchApply(jsonPost(`${repoId}/patches/apply`, {}), ctx(repoId));
    for (const res of [badName, badApply]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('shelves 端点：GET 空 → save（含未跟踪）→ restore（回工作区）→ drop 往返均 200', async () => {
    const repoId = registerRepo();
    const emptyRes = await getShelves(new Request(`http://localhost/api/repos/${repoId}/shelves`), ctx(repoId));
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ shelves: [] });

    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    writeFileSync(join(lastRepoPath, 'new.txt'), 'new\n');
    const saveRes = await postShelves(jsonPost(`${repoId}/shelves`, { action: 'save', name: 'wip' }), ctx(repoId));
    expect(saveRes.status).toBe(200);
    const saved = await saveRes.json();
    expect(saved.shelves).toHaveLength(1);
    expect(saved.shelves[0]).toMatchObject({ name: 'wip', untrackedCount: 1 });

    // restore：清理工作区后回放（tracked 补丁 + 未跟踪回拷），shelf 保留
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '--', 'a.txt']);
    rmSync(join(lastRepoPath, 'new.txt'));
    const restoreRes = await postShelves(jsonPost(`${repoId}/shelves`, { action: 'restore', name: 'wip' }), ctx(repoId));
    expect(restoreRes.status).toBe(200);
    expect(((await restoreRes.json()) as { shelves: unknown[] }).shelves).toHaveLength(1);
    expect(readFileSync(join(lastRepoPath, 'a.txt'), 'utf8')).toBe('hello\nworld\n');
    expect(readFileSync(join(lastRepoPath, 'new.txt'), 'utf8')).toBe('new\n');

    const dropRes = await postShelves(jsonPost(`${repoId}/shelves`, { action: 'drop', name: 'wip' }), ctx(repoId));
    expect(dropRes.status).toBe(200);
    expect(await dropRes.json()).toEqual({ shelves: [] });
  });

  it('shelves 端点：save 重名 → 400 INVALID_QUERY；restore 不存在 → 400 INVALID_REF；未知 action（zod 拒绝）→ 400', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const body = (b: unknown) => jsonPost(`${repoId}/shelves`, b);
    const first = await postShelves(body({ action: 'save', name: 'dup' }), ctx(repoId));
    expect(first.status).toBe(200);
    const dup = await postShelves(body({ action: 'save', name: 'dup' }), ctx(repoId));
    expect(dup.status).toBe(400);
    expect(await dup.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const ghost = await postShelves(body({ action: 'restore', name: 'ghost' }), ctx(repoId));
    expect(ghost.status).toBe(400);
    expect(await ghost.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
    const unknown = await postShelves(body({ action: 'apply', name: 'x' }), ctx(repoId));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('console 端点：真实调用链制造 git 操作后 GET 返回 200 且 id 从 1 递增、args 为数组', async () => {
    const repoId = registerRepo();
    // 先经 status 端点产生真实 git 记录（runGit 按 resolveRepo 产出的同串 cwd 键控）
    await getStatus(new Request(`http://localhost/api/repos/${repoId}/status`), ctx(repoId));
    const res = await getConsole(new Request(`http://localhost/api/repos/${repoId}/console`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.map((e: { id: number }) => e.id)).toEqual(body.map((_e: unknown, i: number) => i + 1));
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
    const repoId = registerRepo();
    const res = await getConsole(new Request(`http://localhost/api/repos/${repoId}/console?limit=501`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('ignore 端点：GET 读空 → PUT 整写 → add 幂等追加 → templates 三模板，均 200', async () => {
    const repoId = registerRepo();
    const getRes = await getIgnore(new Request(`http://localhost/api/repos/${repoId}/ignore`), ctx(repoId));
    expect(getRes.status).toBe(200);
    const read = await getRes.json();
    expect(read.gitignore).toBe('');
    expect(typeof read.exclude).toBe('string');

    const putRes = await putIgnore(
      new Request(`http://localhost/api/repos/${repoId}/ignore`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'gitignore', content: 'node_modules/\n' }),
      }),
      ctx(repoId),
    );
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).gitignore).toBe('node_modules/\n');

    // add：追加 /<path>；重复追加幂等（行 trim 判等不重复）
    const addRes = await postIgnoreAdd(jsonPost(`${repoId}/ignore/add`, { path: 'dist' }), ctx(repoId));
    expect(addRes.status).toBe(200);
    expect((await addRes.json()).gitignore).toBe('node_modules/\n/dist\n');
    const againRes = await postIgnoreAdd(jsonPost(`${repoId}/ignore/add`, { path: 'dist' }), ctx(repoId));
    expect(againRes.status).toBe(200);
    expect((await againRes.json()).gitignore).toBe('node_modules/\n/dist\n');

    const tplRes = await getIgnoreTemplates(new Request(`http://localhost/api/repos/${repoId}/ignore/templates`), ctx(repoId));
    expect(tplRes.status).toBe(200);
    const templates = await tplRes.json();
    expect(templates.map((t: { id: string }) => t.id)).toEqual(['node', 'python', 'general']);
    expect(templates.map((t: { name: string }) => t.name)).toEqual(['Node.js', 'Python', '通用']);
  });

  it('ignore 端点：PUT 非法 target（zod 拒绝）与 add 缺 path 均 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const putRes = await putIgnore(
      new Request(`http://localhost/api/repos/${repoId}/ignore`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'user', content: 'x' }),
      }),
      ctx(repoId),
    );
    const addRes = await postIgnoreAdd(jsonPost(`${repoId}/ignore/add`, {}), ctx(repoId));
    for (const res of [putRes, addRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：patches/shelves/console/ignore 及其子端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getPatches(new Request('http://localhost/api/repos/nope/patches'), ctx('nope')),
      postPatchCreate(jsonPost('nope/patches/create', { name: 'p' }), ctx('nope')),
      postPatchApply(jsonPost('nope/patches/apply', { name: 'p' }), ctx('nope')),
      postPatchDelete(jsonPost('nope/patches/delete', { name: 'p' }), ctx('nope')),
      getShelves(new Request('http://localhost/api/repos/nope/shelves'), ctx('nope')),
      postShelves(jsonPost('nope/shelves', { action: 'save', name: 'w' }), ctx('nope')),
      getConsole(new Request('http://localhost/api/repos/nope/console'), ctx('nope')),
      getIgnore(new Request('http://localhost/api/repos/nope/ignore'), ctx('nope')),
      putIgnore(
        new Request('http://localhost/api/repos/nope/ignore', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: 'gitignore', content: 'x' }),
        }),
        ctx('nope'),
      ),
      postIgnoreAdd(jsonPost('nope/ignore/add', { path: 'x' }), ctx('nope')),
      getIgnoreTemplates(new Request('http://localhost/api/repos/nope/ignore/templates'), ctx('nope')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
