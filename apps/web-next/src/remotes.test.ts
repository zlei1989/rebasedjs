/**
 * web-next remotes/fetch/pull/push/update 路由测试：远端增删改查、fetch/pull/push/update 与强推更新。
 * 拆分自原 routes.test.ts 的 'web-next remotes/fetch/pull/push/update 路由' describe：
 * 原单文件 194s 是测试提速瓶颈，按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getRemotes, POST as postRemotes } from '../app/api/repos/[repoId]/remotes/route';
import { POST as postFetch } from '../app/api/repos/[repoId]/fetch/route';
import { POST as postPull } from '../app/api/repos/[repoId]/pull/route';
import { POST as postPush } from '../app/api/repos/[repoId]/push/route';
import { POST as postUpdate } from '../app/api/repos/[repoId]/update/route';
import { POST as postForcePushedUpdate } from '../app/api/repos/[repoId]/update/force-pushed/route';
import {
  cleanupTestEnv,
  ctx,
  lastRepoPath,
  makeLocalCommit,
  makeRemoteRig,
  pushRemoteCommit,
  registerRepo,
  setupTestEnv,
  tmpDir,
} from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
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
    expect(await getRes.json()).toEqual({ remotes: [], shallow: false });

    const addRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' }),
      ctx(repoId),
    );
    expect(addRes.status).toBe(200);
    expect(await addRes.json()).toEqual({
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' }],
      shallow: false,
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
    expect(await removeRes.json()).toEqual({ remotes: [], shallow: false });
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

  it('push 端点：hash（Push up to Commit）——fetch 后远端领先时 forceWithLease 回推 200 pushed 且对端分支移到该提交；无效 hash → 400 INVALID_REF', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const base = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // force-with-lease 以本地远程跟踪引用为租约期望值（对端领先超出认知时 lease 拒绝）
    execFileSync('git', ['-C', lastRepoPath, 'fetch', '-q', 'origin']);

    const res = await postPush(postJson(`${repoId}/push`, { hash: base, remote: 'origin', forceWithLease: true }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pushed' });
    expect(execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim()).toBe(base);

    const refRes = await postPush(postJson(`${repoId}/push`, { hash: 'deadbeef'.repeat(5), remote: 'origin' }), ctx(repoId));
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
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

  it('update/force-pushed 端点：对端强推后（本地独有提交）→ 200 success + applied 且树含双方内容；无上游 → 400 INVALID_QUERY', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    makeLocalCommit('l1.txt', 'local1', 'local1');
    makeLocalCommit('l2.txt', 'local2', 'local2');
    // 对端强推：另一 clone 从 init 起新增 remote-keep
    const other = tmpDir('rebased-web-next-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 't@e.c']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'T']);
    writeFileSync(join(other, 'r.txt'), 'remote-new');
    execFileSync('git', ['-C', other, 'add', 'r.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'remote-keep']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);

    const res = await postForcePushedUpdate(postJson(`${repoId}/update/force-pushed`, {}), ctx(repoId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; applied: string[] };
    expect(body.status).toBe('success');
    expect(body.applied).toHaveLength(2);
    const logSubjects = execFileSync('git', ['-C', lastRepoPath, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
    expect(logSubjects[0]).toBe('local2');
    expect(logSubjects[1]).toBe('local1');
    expect(logSubjects[2]).toBe('remote-keep');
    expect(readFileSync(join(lastRepoPath, 'r.txt'), 'utf8')).toBe('remote-new');

    // 无上游仓库 → 400 INVALID_QUERY
    const noUpstream = registerRepo();
    const badRes = await postForcePushedUpdate(postJson(`${noUpstream}/update/force-pushed`, {}), ctx(noUpstream));
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postUpdate(postJson('nope/update', { strategy: 'merge' }), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});
