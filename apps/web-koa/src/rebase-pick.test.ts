/**
 * web-koa rebase/cherry-pick/revert/tags 端点集成测试（拆分自 app.test.ts）。
 * 职责：rebase（普通/rebase-todo/interactive/autosquash/冲突全流程）、commit-edit、cherry-pick、
 * revert、operation/continue、tags（create 轻量/附注/push/delete）端点的往返、git log 复核与错误映射断言。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空注册表）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupDirs,
  makeConflictScenario,
  makeLocalCommit,
  makeRemoteRig,
  registerRepo,
  startServer,
  tmpDir,
} from './testing/integration';

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

describe('web-koa rebase/cherry-pick/revert/tags 端点', () => {
  /** 本组用例 git 进程密集（变基/摘樱桃/裸仓库对端 + log 复核），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  /** 在指定仓库上执行 git（返回 stdout） */
  const git = (repoPath: string, args: string[]): string =>
    execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
  const jsonPost = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const jsonGet = (path: string) => fetch(`${base}${path}`);

  it('rebase 端点：main 上 rebase onto side → 200 success 且历史线性', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const main = git(repoPath, ['symbolic-ref', '--short', 'HEAD']).trim();
    git(repoPath, ['checkout', '-q', '-b', 'side']);
    makeLocalCommit(repoPath, 'side.txt', 'side\n', 'side');
    git(repoPath, ['checkout', '-q', main]);
    makeLocalCommit(repoPath, 'main.txt', 'main\n', 'main');

    const res = await jsonPost(`/api/repos/${repoId}/rebase`, { onto: 'side' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['main', 'side', 'init']);
  });

  it('rebase/todo 端点：base..HEAD 反序返回全量提交（哈希+主题）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');
    const two = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const res = await jsonGet(`/api/repos/${repoId}/rebase/todo?base=${base}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { hash: one, subject: 'one' },
      { hash: two, subject: 'two' },
    ]);
  });

  it('rebase/interactive 端点：drop 中间提交 → 200 success 且 git log 复核（中间提交消失）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');
    const two = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'three.txt', 'three\n', 'three');
    const three = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const res = await jsonPost(`/api/repos/${repoId}/rebase/interactive`, {
      base,
      entries: [
        { hash: one, action: 'pick' },
        { hash: two, action: 'drop' },
        { hash: three, action: 'pick' },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['three', 'one', 'init']);
    expect(git(repoPath, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).toContain('one.txt');
    expect(git(repoPath, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).not.toContain('two.txt');
  });

  it('autosquash 端点：squash! 折入目标提交 → 200 success；无暂存 → 400 INVALID_QUERY；无效哈希 → 400 INVALID_REF', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');
    // 暂存 a.txt 改动（squash 提交携带；a.txt 在目标提交树中存在）
    writeFileSync(join(repoPath, 'a.txt'), 'init2\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);

    const res = await jsonPost(`/api/repos/${repoId}/autosquash`, { hash: base, action: 'squash' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    // 提交数不变（折入）；目标提交信息保留（squash shim 覆写 %B）
    expect(execFileSync('git', ['-C', repoPath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('3');
    expect(git(repoPath, ['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['init', 'one', 'two']);
    void one;

    const emptyRes = await jsonPost(`/api/repos/${repoId}/autosquash`, { hash: base, action: 'fixup' });
    expect(emptyRes.status).toBe(400);
    expect(await emptyRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await jsonPost(`/api/repos/${repoId}/autosquash`, { hash: 'deadbeef'.repeat(5), action: 'fixup' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('commit-edit 端点：drop 中间提交 → 200 success 且 git log 复核；reword 缺 message → 400 INVALID_QUERY', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');

    const res = await jsonPost(`/api/repos/${repoId}/commit-edit`, { hash: one, action: 'drop' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['init', 'two']);
    expect(git(repoPath, ['ls-tree', '-r', '--name-only', 'HEAD'])).not.toContain('one.txt');

    const rewRes = await jsonPost(`/api/repos/${repoId}/commit-edit`, { hash: git(repoPath, ['rev-parse', 'HEAD']).trim(), action: 'reword' });
    expect(rewRes.status).toBe(400);
    expect(await rewRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('cherry-pick 端点：祖先提交摘樱桃 → 200 success', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'c.txt', 'two\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    git(repoPath, ['reset', '-q', '--hard', base]);

    const res = await jsonPost(`/api/repos/${repoId}/cherry-pick`, { hashes: [one] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-2']).trim().split('\n')).toEqual(['one', 'init']);
    expect(git(repoPath, ['show', 'HEAD:c.txt'])).toBe('two\n');
  });

  it('cherry-pick 端点：祖先提交（已在当前分支历史）→ 400 INVALID_QUERY 且不留空补丁停态', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'one.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();
    makeLocalCommit(repoPath, 'two.txt', 'two\n', 'two');

    const res = await jsonPost(`/api/repos/${repoId}/cherry-pick`, { hashes: [one] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    // 预检在 git 创建停态之前拦下（复刻终审实验：祖先摘樱桃不再进入空补丁停态）
    expect(existsSync(join(repoPath, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('revert 端点：还原祖先提交 → 200 success 且生成 Revert 提交', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'a.txt', 'one\n', 'one');
    const one = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const res = await jsonPost(`/api/repos/${repoId}/revert`, { hashes: [one] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(repoPath, ['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(git(repoPath, ['show', 'HEAD:a.txt'])).toBe('hello\n');
  });

  it('operation/continue 端点：无进行中操作（无请求体 POST）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/operation/continue`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('rebase 冲突全流程：rebase→conflicts 列表→resolve theirs→operation/continue→操作态清零', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeConflictScenario(repoPath);

    // POST rebase：双向改同一行 → 200 RebaseOutcome{status:'conflicts'}
    const rebaseRes = await jsonPost(`/api/repos/${repoId}/rebase`, { onto: 'side' });
    expect(rebaseRes.status).toBe(200);
    expect(await rebaseRes.json()).toEqual({ status: 'conflicts' });

    // 操作态为 rebase
    const opRes = await jsonGet(`/api/repos/${repoId}/operation`);
    expect(((await opRes.json()) as { kind: string }).kind).toBe('rebase');

    // GET conflicts：冲突路径齐
    const listRes = await jsonGet(`/api/repos/${repoId}/conflicts`);
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

    // POST conflicts/resolve：theirs 采纳 → 列表变空
    const resolveRes = await jsonPost(`/api/repos/${repoId}/conflicts/resolve`, {
      strategy: 'theirs',
      path: 'a.txt',
    });
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toEqual({ conflicts: [] });

    // POST operation/continue（无请求体）：rebase --continue → 200 RepoStatus
    const continueRes = await fetch(`${base}/api/repos/${repoId}/operation/continue`, { method: 'POST' });
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opAfter = await jsonGet(`/api/repos/${repoId}/operation`);
    expect(await opAfter.json()).toEqual({ kind: 'none' });
  });

  it('tags 端点：GET 空 → create 轻量/附注 → push 裸仓库 → delete 往返', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath, bare } = makeRemoteRig();
    const head = git(repoPath, ['rev-parse', 'HEAD']).trim();

    const getRes = await jsonGet(`/api/repos/${repoId}/tags`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ tags: [] });

    // 轻量标签：hash 即提交哈希，subject 即提交主题，annotated=false
    const createLight = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'create', name: 'v1', ref: 'HEAD' });
    expect(createLight.status).toBe(200);
    let list = (await createLight.json()) as { tags: Array<{ name: string; hash: string; subject: string | null; annotated: boolean }> };
    expect(list.tags).toEqual([{ name: 'v1', hash: head, subject: 'init', annotated: false }]);

    // 附注标签：annotated=true，subject 为附注消息
    const createAnnotated = await jsonPost(`/api/repos/${repoId}/tags`, {
      action: 'create',
      name: 'v2',
      message: '发布 1.0',
    });
    expect(createAnnotated.status).toBe(200);
    list = (await createAnnotated.json()) as typeof list;
    const v2 = list.tags.find((t) => t.name === 'v2');
    expect(v2?.annotated).toBe(true);
    expect(v2?.subject).toBe('发布 1.0');

    // push 到裸仓库对端：200 刷新列表且对端 refs/tags/v1 可见
    const pushRes = await jsonPost(`/api/repos/${repoId}/tags`, {
      action: 'push',
      name: 'v1',
      remote: 'origin',
    });
    expect(pushRes.status).toBe(200);
    expect(((await pushRes.json()) as { tags: unknown[] }).tags).toHaveLength(2);
    const bareTag = git(bare, ['rev-parse', 'refs/tags/v1']).trim();
    expect(bareTag).toBe(head);

    // delete：200 刷新列表仅剩 v1
    const deleteRes = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'delete', name: 'v2' });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ tags: [{ name: 'v1', hash: head, subject: 'init', annotated: false }] });
  });

  it('tags 端点：create 重名 → 400 INVALID_QUERY；delete 不存在 → 400 INVALID_REF', async () => {
    const { repoId } = registerRepo();
    await jsonPost(`/api/repos/${repoId}/tags`, { action: 'create', name: 'v1' });
    const dupRes = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'create', name: 'v1' });
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const delRes = await jsonPost(`/api/repos/${repoId}/tags`, { action: 'delete', name: 'ghost' });
    expect(delRes.status).toBe(400);
    expect(await delRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('zod 反例：空 onto / 空 entries / 空 hashes / 缺 base / 未知 tag action 均返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const results = await Promise.all([
      jsonPost(`/api/repos/${repoId}/rebase`, { onto: '' }),
      jsonPost(`/api/repos/${repoId}/rebase/interactive`, { base: 'HEAD', entries: [] }),
      jsonPost(`/api/repos/${repoId}/cherry-pick`, { hashes: [] }),
      jsonGet(`/api/repos/${repoId}/rebase/todo`),
      jsonPost(`/api/repos/${repoId}/tags`, { action: 'rename', name: 'v1' }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：rebase/tags/operation-continue 返回 404 REPO_NOT_FOUND', async () => {
    const rebaseRes = await jsonPost('/api/repos/nope/rebase', { onto: 'side' });
    expect(rebaseRes.status).toBe(404);
    expect(await rebaseRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const tagsRes = await jsonGet('/api/repos/nope/tags');
    expect(tagsRes.status).toBe(404);
    expect(await tagsRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const contRes = await fetch(`${base}/api/repos/nope/operation/continue`, { method: 'POST' });
    expect(contRes.status).toBe(404);
    expect(await contRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});
