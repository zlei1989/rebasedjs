/**
 * web-next REST 路由测试：直接构造 Request 调 route 函数（不起 Next 服务）。
 * 每个用例独立 REBASED_CONFIG_DIR（空注册表）；成功路径先注册临时 git 仓库再断言响应形状。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getRepos } from '../app/api/repos/route';
import { POST as postOpen } from '../app/api/repos/open/route';
import { GET as getStatus } from '../app/api/repos/[repoId]/status/route';
import { GET as getLog } from '../app/api/repos/[repoId]/log/route';
import { GET as getDiff } from '../app/api/repos/[repoId]/diff/route';
import { GET as getConfig, PUT as putConfig } from '../app/api/repos/[repoId]/config/route';
import { GET as getOperation } from '../app/api/repos/[repoId]/operation/route';
import { POST as postAbort } from '../app/api/repos/[repoId]/operation/abort/route';
import { POST as postStaging } from '../app/api/repos/[repoId]/staging/route';
import { POST as postHunkStaging } from '../app/api/repos/[repoId]/staging/hunks/route';
import { POST as postCommit } from '../app/api/repos/[repoId]/commit/route';
import { GET as getBranches, POST as postBranches } from '../app/api/repos/[repoId]/branches/route';
import { POST as postCheckout } from '../app/api/repos/[repoId]/checkout/route';
import { POST as postReset } from '../app/api/repos/[repoId]/reset/route';
import { POST as postUndoCommit } from '../app/api/repos/[repoId]/reset/undo-commit/route';
import { GET as getDiffPatch } from '../app/api/repos/[repoId]/diff/patch/route';
import { GET as getSettings, PUT as putSettings } from '../app/api/settings/route';

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

/** 最近一次 registerRepo 的仓库磁盘路径（供测试内制造工作区改动） */
let lastRepoPath = '';

/** 建临时 git 仓库（一次提交）并写入配置注册表，返回注册 repoId */
function registerRepo(): string {
  const repo = tmpDir('rebased-web-next-repo-');
  lastRepoPath = repo;
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test User']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  writeFileSync(
    join(process.env.REBASED_CONFIG_DIR as string, 'config.json'),
    JSON.stringify({
      repos: [{ id: 'r1', path: repo, name: 'tmp-repo', openedAt: new Date().toISOString() }],
      settings: { logInEditor: true, recentRepoIds: ['r1'] },
    }),
  );
  return 'r1';
}

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-next-config-');
});

afterEach(() => {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('web-next REST 路由', () => {
  it('log 端点：无 repoId 参数返回 400 INVALID_QUERY', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/x/log'), ctx(''));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('log 端点：limit 超界返回 400 INVALID_QUERY', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/x/log?limit=9999'), ctx('x'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  // 注：真实仓库路径经 getRepoById——无注册仓库时返回 404 REPO_NOT_FOUND（getRepoById 抛错 → 映射）
  it('status 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getStatus(new Request('http://localhost/api/repos/nope/status'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('log 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/nope/log'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('diff 端点：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const res = await getDiff(new Request('http://localhost/api/repos/r1/diff'), ctx('r1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('repos 端点：空注册表返回 200 与空数组', async () => {
    const res = await getRepos();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('open 端点：请求体缺 path 返回 400 INVALID_QUERY', async () => {
    const res = await postOpen(
      new Request('http://localhost/api/repos/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('open 端点：非 git 目录返回 400 NOT_A_GIT_REPO', async () => {
    const dir = tmpDir('rebased-web-next-plain-');
    const res = await postOpen(
      new Request('http://localhost/api/repos/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_A_GIT_REPO' } });
  });

  it('settings 端点：GET 返回默认设置，PUT 局部更新后回读生效', async () => {
    const beforeRes = await getSettings();
    expect(beforeRes.status).toBe(200);
    expect(await beforeRes.json()).toEqual({ logInEditor: true, recentRepoIds: [] });

    const res = await putSettings(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logInEditor: false }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ logInEditor: false });

    const afterRes = await getSettings();
    expect(await afterRes.json()).toMatchObject({ logInEditor: false });
  });

  it('settings 端点：PUT 非法字段类型返回 400 INVALID_QUERY', async () => {
    const res = await putSettings(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logInEditor: 'yes' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('status 端点：已注册仓库返回 200 与 RepoStatus 形状', async () => {
    const repoId = registerRepo();
    const res = await getStatus(new Request(`http://localhost/api/repos/${repoId}/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ahead: 0, behind: 0, entries: [] });
    expect(typeof body.branch).toBe('string');
  });

  it('log 端点：已注册仓库返回 200 与 LogPage 形状', async () => {
    const repoId = registerRepo();
    const res = await getLog(new Request(`http://localhost/api/repos/${repoId}/log`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hasMore: false });
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toContain('init');
    expect(body.commits[0]).toMatchObject({ author: 'Test User' });
  });

  it('diff 端点：已注册仓库 + file 返回 200 与 FileVersions 形状（Monaco 两侧全文）', async () => {
    const repoId = registerRepo();
    const res = await getDiff(new Request(`http://localhost/api/repos/${repoId}/diff?file=a.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ before: 'hello\n', after: 'hello\n' });
  });

  it('config 端点：GET 返回 200 且 entries 覆盖 user.name 白名单键', async () => {
    const repoId = registerRepo();
    const res = await getConfig(new Request(`http://localhost/api/repos/${repoId}/config`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.entries.find((e: { key: string }) => e.key === 'user.name');
    expect(entry).toBeDefined();
    expect(entry.localValue).toBe('Test User'); // 夹具仓库本地已设 user.name
  });

  it('config 端点：PUT 白名单键返回 200 且刷新视图 localValue 生效', async () => {
    const repoId = registerRepo();
    const res = await putConfig(
      new Request(`http://localhost/api/repos/${repoId}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'user.name', value: '李四' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.entries.find((e: { key: string }) => e.key === 'user.name');
    expect(entry.localValue).toBe('李四');
  });

  it('config 端点：PUT 白名单外键返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await putConfig(
      new Request(`http://localhost/api/repos/${repoId}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'core.hooksPath', value: '/x' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('config 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getConfig(new Request('http://localhost/api/repos/nope/config'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('operation 端点：无进行中操作返回 200 与 {kind:"none"}', async () => {
    const repoId = registerRepo();
    const res = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'none' });
  });

  it('operation/abort 端点：无进行中操作返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postAbort(
      new Request(`http://localhost/api/repos/${repoId}/operation/abort`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('operation 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getOperation(new Request('http://localhost/api/repos/nope/operation'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('staging 端点：stage 后返回 200 且 entries 反映暂存状态', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const res = await postStaging(
      new Request(`http://localhost/api/repos/${repoId}/staging`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stage', paths: ['a.txt'] }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.entries.find((e: { path: string }) => e.path === 'a.txt');
    expect(entry?.code.startsWith('M.')).toBe(true);
  });

  it('staging 端点：空 paths 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postStaging(
      new Request(`http://localhost/api/repos/${repoId}/staging`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stage', paths: [] }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('staging/hunks 端点：hunk 索引越界返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const res = await postHunkStaging(
      new Request(`http://localhost/api/repos/${repoId}/staging/hunks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stage', file: 'a.txt', hunks: [99] }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('diff/patch 端点：工作区改动后返回 200 且 text 以 diff --git 开头', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const res = await getDiffPatch(new Request(`http://localhost/api/repos/${repoId}/diff/patch?file=a.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('a.txt');
    expect(body.text.startsWith('diff --git')).toBe(true);
  });

  it('diff/patch 端点：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await getDiffPatch(new Request(`http://localhost/api/repos/${repoId}/diff/patch`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('commit 端点：暂存后提交返回 200 且 hash 为 40 位十六进制', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    const res = await postCommit(
      new Request(`http://localhost/api/repos/${repoId}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '测试提交' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('commit 端点：空 message 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postCommit(
      new Request(`http://localhost/api/repos/${repoId}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('branches 端点：GET 返回 200 且列表含当前分支（current=true）', async () => {
    const repoId = registerRepo();
    const current = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = await getBranches(new Request(`http://localhost/api/repos/${repoId}/branches`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.branches.find((b: { name: string }) => b.name === current);
    expect(entry).toBeDefined();
    expect(entry.current).toBe(true);
  });

  it('branches 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getBranches(new Request('http://localhost/api/repos/nope/branches'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('branches 端点：POST create 返回 200 且刷新列表含新分支', async () => {
    const repoId = registerRepo();
    const res = await postBranches(
      new Request(`http://localhost/api/repos/${repoId}/branches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: 'b1' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches.some((b: { name: string }) => b.name === 'b1')).toBe(true);
  });

  it('branches 端点：POST 缺 name 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postBranches(
      new Request(`http://localhost/api/repos/${repoId}/branches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('checkout 端点：branch 检出既有分支返回 200 且 branch 为目标名', async () => {
    const repoId = registerRepo();
    const createRes = await postBranches(
      new Request(`http://localhost/api/repos/${repoId}/branches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: 'b1' }),
      }),
      ctx(repoId),
    );
    expect(createRes.status).toBe(200);
    const res = await postCheckout(
      new Request(`http://localhost/api/repos/${repoId}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'branch', name: 'b1' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).branch).toBe('b1');
  });

  it('checkout 端点：检出不存在分支返回 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    const res = await postCheckout(
      new Request(`http://localhost/api/repos/${repoId}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'branch', name: 'nope' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('reset 端点：soft 重置到 HEAD~1 返回 200 且 headHash 回退', async () => {
    const repoId = registerRepo();
    const base = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'second']);
    const res = await postReset(
      new Request(`http://localhost/api/repos/${repoId}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: 'HEAD~1', mode: 'soft' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.headHash).toBe(base);
  });

  it('reset 端点：空 ref 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postReset(
      new Request(`http://localhost/api/repos/${repoId}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: '', mode: 'soft' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('reset 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postReset(
      new Request('http://localhost/api/repos/nope/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: 'HEAD~1', mode: 'soft' }),
      }),
      ctx('nope'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('reset/undo-commit 端点：撤销最近提交返回 200 且 headHash 回退', async () => {
    const repoId = registerRepo();
    const base = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'second']);
    const res = await postUndoCommit(
      new Request(`http://localhost/api/repos/${repoId}/reset/undo-commit`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.headHash).toBe(base);
  });

  it('reset/undo-commit 端点：根提交上再撤销返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo(); // 仅一次提交（根提交）：无可撤销
    const res = await postUndoCommit(
      new Request(`http://localhost/api/repos/${repoId}/reset/undo-commit`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});
