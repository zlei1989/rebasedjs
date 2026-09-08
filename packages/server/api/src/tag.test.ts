/** tag 功能测试：列表映射、create/delete/push 分派与预检（重名/不存在）、推送后返回刷新列表。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyTagAction, getTags } from './tag';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 裸仓库装置的用例 git 调用密集（本机单次 git 进程启动约秒级），统一放宽用例超时 */
const RIG_TIMEOUT = 120000;

/** 建临时仓库并入册（afterAll 统一清理） */
function makeRepo(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  return repo;
}

/** git 快捷执行（返回 stdout） */
function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

/** 夹具无初始提交：造 base 提交（a.txt 单行），返回默认分支名（随 git 版本不同，动态取值） */
function makeBaseCommit(repo: string): string {
  const main = git(repo, ['symbolic-ref', 'HEAD', '--short']).trim();
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return main;
}

/** 裸仓库 + 远程 origin 装置（配方同 remote.test.ts）：裸仓库 HEAD 指到默认分支 */
function makeRemoteRig(): { repo: string; bare: string; branch: string } {
  const repo = makeRepo();
  const branch = makeBaseCommit(repo);
  const bare = mkdtempSync(join(tmpdir(), 'rebased-api-bare-'));
  dirs.push(bare);
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', '-u', 'origin', branch]);
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  return { repo, bare, branch };
}

describe('getTags', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('无标签 → 空列表；创建轻量与附注后字段映射正确（annotated/subject/hash）', async () => {
    const repo = makeRepo();
    const branch = makeBaseCommit(repo);
    const head = git(repo, ['rev-parse', 'HEAD']).trim();

    expect(await getTags(repo)).toEqual({ tags: [] });

    await applyTagAction(repo, { action: 'create', name: 'light', ref: branch });
    await applyTagAction(repo, { action: 'create', name: 'v1', message: '发布 1.0' });

    const list = await getTags(repo);
    expect(list.tags.map((t) => t.name)).toEqual(['light', 'v1']);

    // 轻量：hash 即提交哈希，subject 即提交主题，annotated=false
    expect(list.tags.find((t) => t.name === 'light')).toEqual({ name: 'light', hash: head, subject: 'base', annotated: false });
    // 附注：annotated=true，subject 为附注消息，hash 为 tag 对象哈希（非提交）
    const annotated = list.tags.find((t) => t.name === 'v1');
    expect(annotated?.annotated).toBe(true);
    expect(annotated?.subject).toBe('发布 1.0');
    expect(annotated?.hash).not.toBe(head);
  });
});

describe('applyTagAction', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('create 重名 → INVALID_QUERY 标签已存在；delete 不存在 → INVALID_REF 标签不存在', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    await applyTagAction(repo, { action: 'create', name: 'v1' });

    await expect(applyTagAction(repo, { action: 'create', name: 'v1', ref: 'HEAD' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '标签已存在：v1',
    });
    await expect(applyTagAction(repo, { action: 'delete', name: 'ghost' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '标签不存在：ghost',
    });
  });

  it('delete 后从列表消失且返回刷新列表', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    await applyTagAction(repo, { action: 'create', name: 'tmp' });

    const afterDelete = await applyTagAction(repo, { action: 'delete', name: 'tmp' });
    expect(afterDelete).toEqual({ tags: [] });
  });

  it(
    'push 到裸仓库：返回刷新列表（标签仍在）且对端可见；push 不存在 → INVALID_REF 标签不存在',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, branch } = makeRemoteRig();
      const head = git(repo, ['rev-parse', 'HEAD']).trim();
      await applyTagAction(repo, { action: 'create', name: 'v1', ref: branch });

      const afterPush = await applyTagAction(repo, { action: 'push', name: 'v1', remote: 'origin' });
      expect(afterPush.tags).toEqual([{ name: 'v1', hash: head, subject: 'base', annotated: false }]);
      expect(git(bare, ['rev-parse', 'refs/tags/v1']).trim()).toBe(head);

      await expect(applyTagAction(repo, { action: 'push', name: 'ghost', remote: 'origin' })).rejects.toMatchObject({
        code: 'INVALID_REF',
        message: '标签不存在：ghost',
      });
    },
  );

  it('pushAll 推送全部标签到裸仓库：对端两标签均可见', { timeout: RIG_TIMEOUT }, async () => {
    const { repo, bare, branch } = makeRemoteRig();
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    await applyTagAction(repo, { action: 'create', name: 't1', ref: branch });
    await applyTagAction(repo, { action: 'create', name: 't2', ref: branch });

    const after = await applyTagAction(repo, { action: 'pushAll', remote: 'origin' });
    expect(after.tags.map((t) => t.name)).toEqual(['t1', 't2']);
    expect(git(bare, ['rev-parse', 'refs/tags/t1']).trim()).toBe(head);
    expect(git(bare, ['rev-parse', 'refs/tags/t2']).trim()).toBe(head);
  });

  it('deleteRemote 删除对端标签：裸仓库 refs/tags 消失且本地列表不变', { timeout: RIG_TIMEOUT }, async () => {
    const { repo, bare, branch } = makeRemoteRig();
    await applyTagAction(repo, { action: 'create', name: 'v1', ref: branch });
    await applyTagAction(repo, { action: 'push', name: 'v1', remote: 'origin' });
    expect(git(bare, ['rev-parse', '--verify', 'refs/tags/v1']).trim()).toMatch(/^[0-9a-f]{40}$/);

    const after = await applyTagAction(repo, { action: 'deleteRemote', name: 'v1', remote: 'origin' });
    // 本地标签仍在（push 空 ref 只删对端）；对端标签消失
    expect(after.tags.map((t) => t.name)).toEqual(['v1']);
    expect(() => git(bare, ['rev-parse', '--verify', 'refs/tags/v1'])).toThrow();
  });

  it('deleteRemote 无远程：git 报错透出（GIT_ERROR 折叠）', { timeout: RIG_TIMEOUT }, async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    await applyTagAction(repo, { action: 'create', name: 'v1' });
    await expect(applyTagAction(repo, { action: 'deleteRemote', name: 'v1' })).rejects.toBeInstanceOf(Error);
  });
});
