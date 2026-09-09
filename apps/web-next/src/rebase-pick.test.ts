/**
 * web-next rebase/cherry-pick/revert/tags 路由测试：变基（普通/交互/autosquash/commit-edit）、摘樱桃、还原、tags 与冲突续作。
 * 拆分自原 routes.test.ts 的 'web-next rebase/cherry-pick/revert/tags 路由' describe：
 * 原单文件 194s 是测试提速瓶颈，按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as postRebase } from '../app/api/repos/[repoId]/rebase/route';
import { GET as getRebaseTodo } from '../app/api/repos/[repoId]/rebase/todo/route';
import { POST as postInteractiveRebase } from '../app/api/repos/[repoId]/rebase/interactive/route';
import { POST as postAutosquash } from '../app/api/repos/[repoId]/autosquash/route';
import { POST as postCommitEdit } from '../app/api/repos/[repoId]/commit-edit/route';
import { POST as postCherryPick } from '../app/api/repos/[repoId]/cherry-pick/route';
import { POST as postRevert } from '../app/api/repos/[repoId]/revert/route';
import { POST as postContinueOperation } from '../app/api/repos/[repoId]/operation/continue/route';
import { GET as getOperation } from '../app/api/repos/[repoId]/operation/route';
import { GET as getConflicts } from '../app/api/repos/[repoId]/conflicts/route';
import { POST as postResolveConflict } from '../app/api/repos/[repoId]/conflicts/resolve/route';
import { GET as getTags, POST as postTags } from '../app/api/repos/[repoId]/tags/route';
import {
  cleanupTestEnv,
  ctx,
  lastRepoPath,
  makeConflictScenario,
  makeLocalCommit,
  makeRemoteRig,
  registerRepo,
  setupTestEnv,
} from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next rebase/cherry-pick/revert/tags 路由', () => {
  /** 本组用例 git 进程密集（变基/摘樱桃/裸仓库对端 + log 复核），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  /** 在最近注册仓库上执行 git（返回 stdout） */
  const git = (args: string[]): string => execFileSync('git', ['-C', lastRepoPath, ...args], { encoding: 'utf8' });
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rebase 端点：main 上 rebase onto side → 200 success 且历史线性', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const main = git(['symbolic-ref', '--short', 'HEAD']).trim();
    git(['checkout', '-q', '-b', 'side']);
    makeLocalCommit('side.txt', 'side\n', 'side');
    git(['checkout', '-q', main]);
    makeLocalCommit('main.txt', 'main\n', 'main');

    const res = await postRebase(jsonPost(`${repoId}/rebase`, { onto: 'side' }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['main', 'side', 'init']);
  });

  it('rebase/todo 端点：base..HEAD 反序返回全量提交（哈希+主题）', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');
    const two = git(['rev-parse', 'HEAD']).trim();

    const res = await getRebaseTodo(
      new Request(`http://localhost/api/repos/${repoId}/rebase/todo?base=${base}`),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { hash: one, subject: 'one' },
      { hash: two, subject: 'two' },
    ]);
  });

  it('rebase/interactive 端点：drop 中间提交 → 200 success 且 git log 复核（中间提交消失）', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');
    const two = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('three.txt', 'three\n', 'three');
    const three = git(['rev-parse', 'HEAD']).trim();

    const res = await postInteractiveRebase(
      jsonPost(`${repoId}/rebase/interactive`, {
        base,
        entries: [
          { hash: one, action: 'pick' },
          { hash: two, action: 'drop' },
          { hash: three, action: 'pick' },
        ],
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['three', 'one', 'init']);
    expect(git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).toContain('one.txt');
    expect(git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).not.toContain('two.txt');
  });

  it('autosquash 端点：squash! 折入目标提交 → 200 success；无暂存 → 400 INVALID_QUERY；无效哈希 → 400 INVALID_REF', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('one.txt', 'one\n', 'one');
    makeLocalCommit('two.txt', 'two\n', 'two');
    // 暂存 a.txt 改动（squash 提交携带；a.txt 在目标提交树中存在）
    writeFileSync(join(lastRepoPath, 'a.txt'), 'init2\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);

    const res = await postAutosquash(jsonPost(`${repoId}/autosquash`, { hash: base, action: 'squash' }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    // 提交数不变（折入）；目标提交信息保留（squash shim 覆写 %B）
    expect(execFileSync('git', ['-C', lastRepoPath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('3');
    expect(git(['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['init', 'one', 'two']);

    const emptyRes = await postAutosquash(jsonPost(`${repoId}/autosquash`, { hash: base, action: 'fixup' }), ctx(repoId));
    expect(emptyRes.status).toBe(400);
    expect(await emptyRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await postAutosquash(jsonPost(`${repoId}/autosquash`, { hash: 'deadbeef'.repeat(5), action: 'fixup' }), ctx(repoId));
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('commit-edit 端点：drop 中间提交 → 200 success 且 git log 复核；reword 缺 message → 400 INVALID_QUERY', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');

    const res = await postCommitEdit(jsonPost(`${repoId}/commit-edit`, { hash: one, action: 'drop' }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['init', 'two']);
    expect(git(['ls-tree', '-r', '--name-only', 'HEAD'])).not.toContain('one.txt');

    const rewRes = await postCommitEdit(jsonPost(`${repoId}/commit-edit`, { hash: git(['rev-parse', 'HEAD']).trim(), action: 'reword' }), ctx(repoId));
    expect(rewRes.status).toBe(400);
    expect(await rewRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('cherry-pick 端点：祖先提交摘樱桃 → 200 success', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('c.txt', 'two\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    git(['reset', '-q', '--hard', base]);

    const res = await postCherryPick(jsonPost(`${repoId}/cherry-pick`, { hashes: [one] }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-2']).trim().split('\n')).toEqual(['one', 'init']);
    expect(git(['show', 'HEAD:c.txt'])).toBe('two\n');
  });

  it('cherry-pick 端点：祖先提交（已在当前分支历史）→ 400 INVALID_QUERY 且不留空补丁停态', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');

    const res = await postCherryPick(jsonPost(`${repoId}/cherry-pick`, { hashes: [one] }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    // 预检在 git 创建停态之前拦下（复刻终审实验：祖先摘樱桃不再进入空补丁停态）
    expect(existsSync(join(lastRepoPath, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('revert 端点：还原祖先提交 → 200 success 且生成 Revert 提交', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('a.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();

    const res = await postRevert(jsonPost(`${repoId}/revert`, { hashes: [one] }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(git(['show', 'HEAD:a.txt'])).toBe('hello\n');
  });

  it('operation/continue 端点：无进行中操作（无请求体 POST）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postContinueOperation(
      new Request(`http://localhost/api/repos/${repoId}/operation/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('rebase 冲突全流程：rebase→conflicts 列表→resolve theirs→operation/continue→操作态清零', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeConflictScenario();

    // POST rebase：双向改同一行 → 200 RebaseOutcome{status:'conflicts'}
    const rebaseRes = await postRebase(jsonPost(`${repoId}/rebase`, { onto: 'side' }), ctx(repoId));
    expect(rebaseRes.status).toBe(200);
    expect(await rebaseRes.json()).toEqual({ status: 'conflicts' });

    // 操作态为 rebase
    const opRes = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect((await opRes.json()) as { kind: string }).toMatchObject({ kind: 'rebase' });

    // GET conflicts：冲突路径齐
    const listRes = await getConflicts(new Request(`http://localhost/api/repos/${repoId}/conflicts`), ctx(repoId));
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

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

    // POST operation/continue（无请求体）：rebase --continue → 200 RepoStatus
    const continueRes = await postContinueOperation(
      new Request(`http://localhost/api/repos/${repoId}/operation/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opAfter = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect(await opAfter.json()).toEqual({ kind: 'none' });
  });

  it('tags 端点：GET 空 → create 轻量/附注 → push 裸仓库 → delete 往返', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare } = makeRemoteRig();
    const head = git(['rev-parse', 'HEAD']).trim();

    const getRes = await getTags(new Request(`http://localhost/api/repos/${repoId}/tags`), ctx(repoId));
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ tags: [] });

    // 轻量标签：hash 即提交哈希，subject 即提交主题，annotated=false
    const createLight = await postTags(
      jsonPost(`${repoId}/tags`, { action: 'create', name: 'v1', ref: 'HEAD' }),
      ctx(repoId),
    );
    expect(createLight.status).toBe(200);
    let list = (await createLight.json()) as { tags: Array<{ name: string; hash: string; subject: string | null; annotated: boolean }> };
    expect(list.tags).toEqual([{ name: 'v1', hash: head, subject: 'init', annotated: false }]);

    // 附注标签：annotated=true，subject 为附注消息
    const createAnnotated = await postTags(
      jsonPost(`${repoId}/tags`, { action: 'create', name: 'v2', message: '发布 1.0' }),
      ctx(repoId),
    );
    expect(createAnnotated.status).toBe(200);
    list = (await createAnnotated.json()) as typeof list;
    const v2 = list.tags.find((t) => t.name === 'v2');
    expect(v2?.annotated).toBe(true);
    expect(v2?.subject).toBe('发布 1.0');

    // push 到裸仓库对端：200 刷新列表且对端 refs/tags/v1 可见
    const pushRes = await postTags(
      jsonPost(`${repoId}/tags`, { action: 'push', name: 'v1', remote: 'origin' }),
      ctx(repoId),
    );
    expect(pushRes.status).toBe(200);
    expect(((await pushRes.json()) as { tags: unknown[] }).tags).toHaveLength(2);
    const bareTag = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/tags/v1'], { encoding: 'utf8' }).trim();
    expect(bareTag).toBe(head);

    // delete：200 刷新列表仅剩 v1
    const deleteRes = await postTags(jsonPost(`${repoId}/tags`, { action: 'delete', name: 'v2' }), ctx(repoId));
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ tags: [{ name: 'v1', hash: head, subject: 'init', annotated: false }] });
  });

  it('tags 端点：create 重名 → 400 INVALID_QUERY；delete 不存在 → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    await postTags(jsonPost(`${repoId}/tags`, { action: 'create', name: 'v1' }), ctx(repoId));
    const dupRes = await postTags(jsonPost(`${repoId}/tags`, { action: 'create', name: 'v1' }), ctx(repoId));
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const delRes = await postTags(jsonPost(`${repoId}/tags`, { action: 'delete', name: 'ghost' }), ctx(repoId));
    expect(delRes.status).toBe(400);
    expect(await delRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('zod 反例：空 onto / 空 entries / 空 hashes / 缺 base / 未知 tag action 均返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const results = await Promise.all([
      postRebase(jsonPost(`${repoId}/rebase`, { onto: '' }), ctx(repoId)),
      postInteractiveRebase(jsonPost(`${repoId}/rebase/interactive`, { base: 'HEAD', entries: [] }), ctx(repoId)),
      postCherryPick(jsonPost(`${repoId}/cherry-pick`, { hashes: [] }), ctx(repoId)),
      getRebaseTodo(new Request(`http://localhost/api/repos/${repoId}/rebase/todo`), ctx(repoId)),
      postTags(jsonPost(`${repoId}/tags`, { action: 'rename', name: 'v1' }), ctx(repoId)),
    ]);
    for (const res of results) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：rebase/tags/operation-continue 返回 404 REPO_NOT_FOUND', async () => {
    const rebaseRes = await postRebase(jsonPost('nope/rebase', { onto: 'side' }), ctx('nope'));
    expect(rebaseRes.status).toBe(404);
    expect(await rebaseRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const tagsRes = await getTags(new Request('http://localhost/api/repos/nope/tags'), ctx('nope'));
    expect(tagsRes.status).toBe(404);
    expect(await tagsRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const contRes = await postContinueOperation(
      new Request('http://localhost/api/repos/nope/operation/continue', { method: 'POST' }),
      ctx('nope'),
    );
    expect(contRes.status).toBe(404);
    expect(await contRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});
