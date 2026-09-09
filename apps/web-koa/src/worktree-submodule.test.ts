/**
 * web-koa worktree/submodule 域端点集成测试（拆分自 app.test.ts）。
 * 职责：worktrees（列表/create newBranch/branch 挂接/互斥预检/remove/prune）与
 * submodules（列表/检出旧提交 different-commit/update 复原）端点的往返断言（路径等价归一、
 * gitlink 校验）。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空注册表）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
