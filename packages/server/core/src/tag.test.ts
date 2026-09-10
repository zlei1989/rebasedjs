/** tag 原语测试：轻量/附注创建与列表解析、删除、推送三态（裸仓库对端装置）。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { createTag, deleteRemoteTag, deleteTag, listTags, pushAllTags, pushTag } from './tag';
import { defaultRemoteName } from './remote';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 建临时仓库并入册（afterAll 统一清理） */
function makeRepo(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  return repo;
}

/** 造 base 提交（a.txt 单行），返回默认分支名（随 git 版本不同，动态取值） */
async function makeBaseCommit(repo: string): Promise<string> {
  const { stdout } = await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo });
  const main = stdout.trim();
  await writeFile(join(repo, 'a.txt'), 'base\n');
  await runGit(['add', 'a.txt'], { cwd: repo });
  await runGit(['commit', '-m', 'base'], { cwd: repo });
  return main;
}

/** 裸仓库 + 远程 origin 装置（沿用 remote.test.ts 配方）：裸仓库 HEAD 指到默认分支 */
async function makeRemoteRig(): Promise<{ repo: string; bare: string; branch: string }> {
  const repo = makeRepo();
  const branch = await makeBaseCommit(repo);
  const bare = createTmpDir('rebased-core-bare-');
  dirs.push(bare);
  await runGit(['init', '--bare', bare], { cwd: repo });
  await runGit(['remote', 'add', 'origin', bare], { cwd: repo });
  await runGit(['push', '-q', '-u', 'origin', branch], { cwd: repo });
  await runGit(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: bare });
  return { repo, bare, branch };
}

describe('tag 创建与列表', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('轻量（无 message）与附注（有 message）创建，listTags 字段与附注解析正确', async () => {
    const repo = makeRepo();
    const branch = await makeBaseCommit(repo);
    const head = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    await createTag(repo, { name: 'light', ref: branch });
    await createTag(repo, { name: 'v1', message: '发布 1.0' });

    const tags = await listTags(repo);
    expect(tags.map((t) => t.name)).toEqual(['light', 'v1']);

    // 轻量：hash 即提交哈希，subject 即提交主题，annotated=false
    const light = tags.find((t) => t.name === 'light');
    expect(light).toEqual({ name: 'light', hash: head, subject: 'base', annotated: false });

    // 附注：hash 为 tag 对象哈希（非提交），annotated=true，subject 为附注消息
    const annotated = tags.find((t) => t.name === 'v1');
    expect(annotated?.annotated).toBe(true);
    expect(annotated?.subject).toBe('发布 1.0');
    expect(annotated?.hash).not.toBe(head);
    expect((await runGit(['rev-parse', `${annotated!.hash}^{}`], { cwd: repo })).stdout.trim()).toBe(head);
  });

  it('删除后列表消失；删除不存在的标签抛 GitExitError', async () => {
    const repo = makeRepo();
    await makeBaseCommit(repo);
    await createTag(repo, { name: 'tmp' });
    expect((await listTags(repo)).map((t) => t.name)).toEqual(['tmp']);

    await deleteTag(repo, 'tmp');
    expect(await listTags(repo)).toEqual([]);

    await expect(deleteTag(repo, 'ghost')).rejects.toBeInstanceOf(GitExitError);
  });
});

describe('pushTag', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it(
    '推送到裸仓库：pushed 且对端可见；重复推送 → up-to-date；对端已有同名不同指向 → rejected',
    { timeout: 60000 },
    async () => {
      const { repo, bare, branch } = await makeRemoteRig();

      await createTag(repo, { name: 'v1', message: '发布 1.0' });
      const r1 = await pushTag(repo, { name: 'v1', remote: 'origin' });
      expect(r1.status).toBe('pushed');
      expect((await runGit(['rev-parse', 'refs/tags/v1'], { cwd: bare })).stdout.trim()).toBe(
        (await runGit(['rev-parse', 'refs/tags/v1'], { cwd: repo })).stdout.trim(),
      );

      const r2 = await pushTag(repo, { name: 'v1', remote: 'origin' });
      expect(r2.status).toBe('up-to-date');

      // 本地删除后改指向再推：远端已存在同名标签 → rejected（already exists）
      await deleteTag(repo, 'v1');
      await createTag(repo, { name: 'v1', ref: branch, message: '发布 1.0（改指向）' });
      const r3 = await pushTag(repo, { name: 'v1', remote: 'origin' });
      expect(r3.status).toBe('rejected');
    },
  );

  it(
    'pushAllTags 推送全部：两标签均达对端；重复推送 → up-to-date',
    { timeout: 60000 },
    async () => {
      const { repo, bare, branch } = await makeRemoteRig();
      await createTag(repo, { name: 't1', ref: branch });
      await createTag(repo, { name: 't2', ref: branch });

      // 未传 remote：解析缺省远程（回归 D-26/D-27——缺远程时 git 把 refspec 当仓库地址）
      const r1 = await pushAllTags(repo, {});
      expect(r1.status).toBe('pushed');
      const head = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
      expect((await runGit(['rev-parse', 'refs/tags/t1'], { cwd: bare })).stdout.trim()).toBe(head);
      expect((await runGit(['rev-parse', 'refs/tags/t2'], { cwd: bare })).stdout.trim()).toBe(head);

      const r2 = await pushAllTags(repo, { remote: 'origin' });
      expect(r2.status).toBe('up-to-date');
    },
  );

  // 回归（D-27）：UI 推送单个标签时不传 remote，旧实现跑 `git push refs/tags/<name>` ——
  // 当前分支无上游时 git 把 refspec 当仓库地址（`does not appear to be a git repository`）。
  it(
    'pushTag 未传 remote：解析缺省远程并推送成功（当前分支无上游时同样可用）',
    { timeout: 60000 },
    async () => {
      const { repo, bare, branch } = await makeRemoteRig();
      // 抹掉分支上游，复刻冒烟仓 rebase-topic 的形态（只有 origin 远程、分支无 upstream）
      await runGit(['config', '--unset', `branch.${branch}.remote`], { cwd: repo });
      await runGit(['config', '--unset', `branch.${branch}.merge`], { cwd: repo });
      await createTag(repo, { name: 'v9', ref: branch });

      const r = await pushTag(repo, { name: 'v9' });
      expect(r.status).toBe('pushed');
      expect((await runGit(['rev-parse', 'refs/tags/v9'], { cwd: bare })).stdout.trim()).toBe(
        (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim(),
      );
    },
  );

  it(
    'pushTag / pushAllTags 仓库无远程：可读中文报错（不落到 git 的仓库地址解析）',
    { timeout: 60000 },
    async () => {
      const repo = makeRepo();
      const branch = await makeBaseCommit(repo);
      await createTag(repo, { name: 'v9', ref: branch });

      await expect(pushTag(repo, { name: 'v9' })).rejects.toThrow(/未配置远程/);
      await expect(pushAllTags(repo, {})).rejects.toThrow(/未配置远程/);
    },
  );

  it(
    'deleteRemoteTag 删除对端标签：裸仓库 refs/tags 消失；本地标签不受影响',
    { timeout: 60000 },
    async () => {
      const { repo, bare, branch } = await makeRemoteRig();
      await createTag(repo, { name: 'v1', ref: branch });
      await pushTag(repo, { name: 'v1', remote: 'origin' });
      expect((await runGit(['rev-parse', '--verify', 'refs/tags/v1'], { cwd: bare })).stdout.trim()).toMatch(/^[0-9a-f]{40}$/);

      await deleteRemoteTag(repo, { name: 'v1', remote: 'origin' });
      await expect(runGit(['rev-parse', '--verify', 'refs/tags/v1'], { cwd: bare })).rejects.toBeInstanceOf(GitExitError);
      // 本地标签仍在
      expect((await listTags(repo)).map((t) => t.name)).toEqual(['v1']);
    },
  );

  // 回归（D-26）：缺 remote 时旧实现跑 `git push :refs/tags/<name>`——git 把该参数当仓库地址，
  // 报 `ssh: connect to host  port 22`（UI 从不传 remote，故线上必现）。现按 defaultRemoteName 解析。
  it(
    'deleteRemoteTag 未传 remote：解析分支上游远程并对端删除成功（不再报 ssh 连空 host）',
    { timeout: 60000 },
    async () => {
      const { repo, bare, branch } = await makeRemoteRig();
      await createTag(repo, { name: 'v2', ref: branch });
      await pushTag(repo, { name: 'v2', remote: 'origin' });
      expect((await runGit(['rev-parse', '--verify', 'refs/tags/v2'], { cwd: bare })).stdout.trim()).toMatch(/^[0-9a-f]{40}$/);

      await deleteRemoteTag(repo, { name: 'v2' });
      await expect(runGit(['rev-parse', '--verify', 'refs/tags/v2'], { cwd: bare })).rejects.toBeInstanceOf(GitExitError);
      expect((await listTags(repo)).map((t) => t.name)).toEqual(['v2']);
    },
  );

  it(
    'deleteRemoteTag 仓库无远程：给出可读中文报错（不落到 git 的 ssh/仓库地址解析）',
    { timeout: 60000 },
    async () => {
      const repo = makeRepo();
      const branch = await makeBaseCommit(repo);
      await createTag(repo, { name: 'v3', ref: branch });

      await expect(deleteRemoteTag(repo, { name: 'v3' })).rejects.toThrow(/未配置远程/);
    },
  );

  it('defaultRemoteName：分支上游优先，其次 origin，再退唯一远程；无远程返回 undefined', async () => {
    const noRemote = makeRepo();
    await makeBaseCommit(noRemote);
    expect(await defaultRemoteName(noRemote)).toBeUndefined();

    const { repo } = await makeRemoteRig();
    // 分支已 -u 到 origin（makeRemoteRig 内 setUpstream）→ 取分支配置的上游远程
    expect(await defaultRemoteName(repo)).toBe('origin');

    // 分支未配置上游但存在 origin → 约定缺省 origin
    const bare2 = createTmpDir('rebased-core-bare-');
    dirs.push(bare2);
    await runGit(['init', '--bare', bare2], { cwd: repo });
    await runGit(['remote', 'add', 'upstream', bare2], { cwd: repo });
    const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })).stdout.trim();
    await runGit(['config', '--unset', `branch.${branch}.remote`], { cwd: repo });
    expect(await defaultRemoteName(repo)).toBe('origin');
    await runGit(['remote', 'remove', 'origin'], { cwd: repo });
    // 仅剩一个非 origin 远程 → 退到唯一远程
    expect(await defaultRemoteName(repo)).toBe('upstream');
  });
});
