/**
 * web-next worktree/submodule 域路由测试：worktrees 列表/创建/移除/prune 与 submodules 列表/更新。
 * 拆分自原 routes.test.ts 的 'web-next worktree/submodule 域路由' describe：原单文件 194s 是测试提速瓶颈，
 * 按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getWorktrees, POST as postWorktreeCreate } from '../app/api/repos/[repoId]/worktrees/route';
import { POST as postWorktreeRemove } from '../app/api/repos/[repoId]/worktrees/remove/route';
import { POST as postWorktreePrune } from '../app/api/repos/[repoId]/worktrees/prune/route';
import { GET as getSubmodulesRoute } from '../app/api/repos/[repoId]/submodules/route';
import { POST as postSubmoduleUpdate } from '../app/api/repos/[repoId]/submodules/update/route';
import { cleanupTestEnv, ctx, lastRepoPath, registerRepo, setupTestEnv, tmpDir } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next worktree/submodule 域路由', () => {
  /** 子模块装置用例 git 进程密集（content 仓库 + bare + submodule add + 多次 status），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
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
    const repoId = registerRepo();
    const res = await getWorktrees(new Request(`http://localhost/api/repos/${repoId}/worktrees`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worktrees).toHaveLength(1);
    const main = body.worktrees[0];
    expect(samePath(main.path, lastRepoPath)).toBe(true);
    expect(main.branch).toBe(git(lastRepoPath, ['symbolic-ref', '--short', 'HEAD']));
    expect(main.detached).toBe(false);
    expect(main.head).toBe(git(lastRepoPath, ['rev-parse', 'HEAD']));
  });

  it('create 端点 newBranch：200 刷新列表含主+副（副 branch/head 完整）', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-new');
    const res = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, newBranch: 'feat-route' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worktrees).toHaveLength(2);
    const wt = body.worktrees.find((w: { path: string }) => samePath(w.path, wtPath));
    expect(wt).toMatchObject({ branch: 'feat-route', detached: false });
    expect(wt.head).toBe(git(lastRepoPath, ['rev-parse', 'refs/heads/feat-route']));
  });

  it('create 端点 branch 挂接既有分支', async () => {
    const repoId = registerRepo();
    git(lastRepoPath, ['branch', 'feat']);
    const wtPath = siblingPath(lastRepoPath, '-wt-attach');
    const res = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, branch: 'feat' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const wt = body.worktrees.find((w: { path: string }) => samePath(w.path, wtPath));
    expect(wt).toMatchObject({ branch: 'feat', detached: false });
  });

  it('create 端点互斥预检：都缺/同给 → 400 INVALID_QUERY；分支不存在 → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-excl');
    const missing = await postWorktreeCreate(jsonPost(`${repoId}/worktrees`, { path: wtPath }), ctx(repoId));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const both = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, branch: 'a', newBranch: 'b' }),
      ctx(repoId),
    );
    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const noBranch = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, branch: 'nope' }),
      ctx(repoId),
    );
    expect(noBranch.status).toBe(400);
    expect(await noBranch.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('create 端点 zod 反例：path 空 → 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: '', newBranch: 'x' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('remove 端点：创建后移除 → 200 列表复原；已不存在 → 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-rm');
    const created = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, newBranch: 'rm-b' }),
      ctx(repoId),
    );
    expect((await created.json()).worktrees).toHaveLength(2);

    const res = await postWorktreeRemove(jsonPost(`${repoId}/worktrees/remove`, { path: wtPath }), ctx(repoId));
    expect(res.status).toBe(200);
    expect((await res.json()).worktrees).toHaveLength(1);

    const gone = await postWorktreeRemove(jsonPost(`${repoId}/worktrees/remove`, { path: wtPath }), ctx(repoId));
    expect(gone.status).toBe(400);
    expect(await gone.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('prune 端点：目录缺失的陈旧条目被清理 → 200 列表复原', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-stale');
    const created = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, newBranch: 'stale-b' }),
      ctx(repoId),
    );
    expect((await created.json()).worktrees).toHaveLength(2);
    rmSync(wtPath, { recursive: true, force: true });

    const res = await postWorktreePrune(
      new Request(`http://localhost/api/repos/${repoId}/worktrees/prune`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).worktrees).toHaveLength(1);
  });

  it('submodules 列表/更新往返：add 后 checked-out → 检出旧提交 different-commit → update 复原', { timeout: RIG_TIMEOUT }, async () => {
    const content = tmpDir('rebased-web-next-subcontent-');
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
    const repoId = registerRepo();
    git(lastRepoPath, ['-c', 'protocol.file.allow=always', 'submodule', 'add', bareUrl, 'sub']);
    git(lastRepoPath, ['add', '-A']);
    git(lastRepoPath, ['commit', '-q', '-m', 'addsub']);
    const gitlinkSha = git(lastRepoPath, ['rev-parse', 'HEAD:sub']);
    expect(gitlinkSha).toBe(bSha);

    // 初始：submodule add 后即 checked-out（commitSha=gitlink sha）
    let res = await getSubmodulesRoute(new Request(`http://localhost/api/repos/${repoId}/submodules`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'checked-out', commitSha: bSha }],
    });

    // 子模块工作树检出旧提交 A → different-commit
    git(join(lastRepoPath, 'sub'), ['checkout', '-q', aSha]);
    res = await getSubmodulesRoute(new Request(`http://localhost/api/repos/${repoId}/submodules`), ctx(repoId));
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'different-commit', commitSha: aSha }],
    });

    // update 复原 checked-out（无网络：对象在本仓库）；CLI 复核实际检出
    res = await postSubmoduleUpdate(jsonPost(`${repoId}/submodules/update`, {}), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'checked-out', commitSha: bSha }],
    });
    expect(git(join(lastRepoPath, 'sub'), ['rev-parse', 'HEAD'])).toBe(bSha);
  });

  it('未注册 repoId：worktree/submodule 全部 6 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getWorktrees(new Request('http://localhost/api/repos/nope/worktrees'), ctx('nope')),
      postWorktreeCreate(jsonPost('nope/worktrees', { path: 'C:/wt', newBranch: 'x' }), ctx('nope')),
      postWorktreeRemove(jsonPost('nope/worktrees/remove', { path: 'C:/wt' }), ctx('nope')),
      postWorktreePrune(new Request('http://localhost/api/repos/nope/worktrees/prune', { method: 'POST' }), ctx('nope')),
      getSubmodulesRoute(new Request('http://localhost/api/repos/nope/submodules'), ctx('nope')),
      postSubmoduleUpdate(jsonPost('nope/submodules/update', {}), ctx('nope')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
