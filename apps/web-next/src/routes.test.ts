/**
 * web-next REST 路由测试：直接构造 Request 调 route 函数（不起 Next 服务）。
 * 每个用例独立 REBASED_CONFIG_DIR（空注册表）；成功路径先注册临时 git 仓库再断言响应形状。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { GET as getStashes, POST as postStashes } from '../app/api/repos/[repoId]/stashes/route';
import { GET as getRemotes, POST as postRemotes } from '../app/api/repos/[repoId]/remotes/route';
import { POST as postFetch } from '../app/api/repos/[repoId]/fetch/route';
import { POST as postPull } from '../app/api/repos/[repoId]/pull/route';
import { POST as postPush } from '../app/api/repos/[repoId]/push/route';
import { POST as postUpdate } from '../app/api/repos/[repoId]/update/route';
import { GET as getChangelists, POST as postChangelists } from '../app/api/repos/[repoId]/changelists/route';
import { POST as postCheckout } from '../app/api/repos/[repoId]/checkout/route';
import { POST as postReset } from '../app/api/repos/[repoId]/reset/route';
import { POST as postUndoCommit } from '../app/api/repos/[repoId]/reset/undo-commit/route';
import { GET as getDiffPatch } from '../app/api/repos/[repoId]/diff/patch/route';
import { POST as postMerge } from '../app/api/repos/[repoId]/merge/route';
import { POST as postMergeContinue } from '../app/api/repos/[repoId]/merge/continue/route';
import { GET as getConflicts } from '../app/api/repos/[repoId]/conflicts/route';
import { GET as getConflictContentsRoute } from '../app/api/repos/[repoId]/conflicts/contents/route';
import { POST as postResolveConflict } from '../app/api/repos/[repoId]/conflicts/resolve/route';
import { GET as getSettings, PUT as putSettings } from '../app/api/settings/route';
import { GET as getAccounts, POST as postAccounts } from '../app/api/auth/accounts/route';
import { POST as postAccountDelete } from '../app/api/auth/accounts/delete/route';

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

/** 冲突夹具：在 registerRepo 的仓库上造 side/main 两侧改 a.txt 同一行（合并必冲突，stage 1/2/3 全在） */
function makeConflictScenario(): void {
  const repo = lastRepoPath;
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

/** 裸仓库对端装置：注册仓库 + bare 当 origin + push -u 建 upstream；裸仓库 HEAD 指默认分支（配方同 api 层 remote 测试） */
function makeRemoteRig(): { repoId: string; bare: string; defaultBranch: string } {
  const repoId = registerRepo();
  const repo = lastRepoPath;
  const defaultBranch = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const bare = tmpDir('rebased-web-next-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare]);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', defaultBranch]);
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repoId, bare, defaultBranch };
}

/** 第二 clone 对端：提交并推到裸仓库默认分支（制造远端新提交/分叉） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = tmpDir('rebased-web-next-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
  writeFileSync(join(other, filename), content);
  execFileSync('git', ['-C', other, 'add', filename]);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', `remote: ${filename}`]);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

/** 本地新提交（在 registerRepo 的仓库工作区上） */
function makeLocalCommit(filename: string, content: string, message: string): void {
  writeFileSync(join(lastRepoPath, filename), content);
  execFileSync('git', ['-C', lastRepoPath, 'add', filename]);
  execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', message]);
}

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-next-config-');
});

afterEach(() => {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('web-next auth 账户路由（应用级，无 repoId）', () => {
  const jsonPost = (url: string, body: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET /api/auth/accounts：空配置返回 200 与空账户列表', async () => {
    const res = await getAccounts();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：添加返回掩码视图且响应不含原 token', async () => {
    const token = 'ghp_secret123456';
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).toEqual({ accounts: [{ host: 'github.com', account: 'zhang', tokenPreview: 'ghp_***' }] });
  });

  it('POST /api/auth/accounts：同 host+account 重复添加覆盖（列表长度 1）', async () => {
    await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'oldtoken123456' }));
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'newtoken654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].tokenPreview).toBe('newt***');
  });

  it('POST /api/auth/accounts/delete：删除后列表移除该账户', async () => {
    await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'ghp_abc123' }));
    const res = await postAccountDelete(jsonPost('http://localhost/api/auth/accounts/delete', { host: 'github.com', account: 'zhang' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：空 token（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('POST /api/auth/accounts/delete：删除不存在账户返回 400 INVALID_QUERY', async () => {
    const res = await postAccountDelete(jsonPost('http://localhost/api/auth/accounts/delete', { host: 'github.com', account: 'nobody' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
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

describe('web-next remotes/fetch/pull/push/update 路由', () => {
  /** 裸仓库装置用例 git 进程密集（本机单次 git 进程启动约秒级），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const postJson = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('remotes 端点：GET 空列表 → add → setUrl → remove 往返均返回刷新 RemoteList', async () => {
    const repoId = registerRepo();
    const getRes = await getRemotes(new Request(`http://localhost/api/repos/${repoId}/remotes`), ctx(repoId));
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ remotes: [] });

    const addRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' }),
      ctx(repoId),
    );
    expect(addRes.status).toBe(200);
    expect(await addRes.json()).toEqual({
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' }],
    });

    const setUrlRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'setUrl', name: 'origin', url: 'https://example.com/b.git' }),
      ctx(repoId),
    );
    expect(setUrlRes.status).toBe(200);
    expect((await setUrlRes.json()).remotes).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
    ]);

    const removeRes = await postRemotes(postJson(`${repoId}/remotes`, { action: 'remove', name: 'origin' }), ctx(repoId));
    expect(removeRes.status).toBe(200);
    expect(await removeRes.json()).toEqual({ remotes: [] });
  });

  it('remotes 端点：add 重名 → 400 INVALID_QUERY；remove 不存在 → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    await postRemotes(postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' }), ctx(repoId));
    const dupRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/x.git' }),
      ctx(repoId),
    );
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const removeRes = await postRemotes(postJson(`${repoId}/remotes`, { action: 'remove', name: 'nope' }), ctx(repoId));
    expect(removeRes.status).toBe(400);
    expect(await removeRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('remotes 端点：未知 action（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postRemotes(postJson(`${repoId}/remotes`, { action: 'wat', name: 'origin' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('remotes 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getRemotes(new Request('http://localhost/api/repos/nope/remotes'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('fetch 端点：对端新提交后 fetch 返回 200 FetchResult（updatedRefs 含对应引用）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postFetch(postJson(`${repoId}/fetch`, {}), ctx(repoId)); // fetch 体可空 {}
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedRefs).toContain(`refs/remotes/origin/${defaultBranch}`);
  });

  it('fetch 端点：remote 非字符串（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postFetch(postJson(`${repoId}/fetch`, { remote: 123 }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('pull 端点：对端新提交 pull 返回 200 updated 且工作区同步', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postPull(postJson(`${repoId}/pull`, { remote: 'origin' }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'updated' });
    expect(readFileSync(join(lastRepoPath, 'b.txt'), 'utf8')).toBe('from-other');
  });

  it('pull 端点：rebase 非布尔（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postPull(postJson(`${repoId}/pull`, { rebase: 'yes' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('push 端点：本地新提交 push 返回 200 pushed 且对端可见', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    makeLocalCommit('b.txt', 'local', 'local commit');
    const res = await postPush(postJson(`${repoId}/push`, { remote: 'origin', branch: defaultBranch }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pushed' });
    const bareHead = execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim();
    expect(bareHead).toBe(execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  });

  it('push 端点：分叉后 push 返回 200 rejected + 中文 hint（业务结果，不做 409 特判）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    makeLocalCommit('c.txt', 'local', 'local commit');
    const res = await postPush(postJson(`${repoId}/push`, { remote: 'origin', branch: defaultBranch }), ctx(repoId));
    expect(res.status).toBe(200); // PushOutcome.rejected 是 200 业务结果，409 保留给真冲突
    expect(await res.json()).toEqual({ status: 'rejected', hint: '远端有更新的提交，请先拉取/变基' });
  });

  it('push 端点：forceWithLease 非布尔（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postPush(postJson(`${repoId}/push`, { forceWithLease: 'yes' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update 端点：merge 策略返回 200 UpdateOutcome（fetched + pull.updated 且工作区同步）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postUpdate(postJson(`${repoId}/update`, { strategy: 'merge' }), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pull.status).toBe('updated');
    expect(body.fetched).toContain(`refs/remotes/origin/${defaultBranch}`);
    expect(readFileSync(join(lastRepoPath, 'b.txt'), 'utf8')).toBe('from-other');
  });

  it('update 端点：非法 strategy（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postUpdate(postJson(`${repoId}/update`, { strategy: 'ff-only' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postUpdate(postJson('nope/update', { strategy: 'merge' }), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});
