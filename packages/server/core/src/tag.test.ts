/** tag 原语测试：轻量/附注创建与列表解析、删除、推送三态（裸仓库对端装置）。 */
import { writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { createTag, deleteTag, listTags, pushTag } from './tag';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

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
  const bare = mkdtempSync(join(tmpdir(), 'rebased-core-bare-'));
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
});
