/**
 * web-koa patch/shelf/console/ignore 端点集成测试（拆分自 app.test.ts）。
 * 职责：patches（create/apply/delete 往返）、shelves（save/restore/drop 含未跟踪）、
 * console（git 执行日志形状与递增 id）、ignore（读写/add 幂等/templates）端点的往返与错误映射断言。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空注册表）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDirs, registerRepo, startServer, tmpDir } from './testing/integration';

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
