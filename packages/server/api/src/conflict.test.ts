/** conflict 功能测试：冲突列表、三版本内容、ours/theirs/manual 三解决路径与刷新列表。 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getConflictContents, getConflicts, resolveConflict } from './conflict';
import { mergeBranchIntoCurrent } from './merge';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

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

/** 造 base 提交（a.txt=base），返回默认分支名 */
function makeBaseCommit(repo: string): string {
  const main = git(repo, ['symbolic-ref', 'HEAD', '--short']).trim();
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return main;
}

/** 冲突场景并入合并态：base 后两侧改 a.txt 同一行，发起合并产生冲突 */
async function repoInConflictedMerge(): Promise<string> {
  const repo = makeRepo();
  const main = makeBaseCommit(repo);
  git(repo, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'side']);
  git(repo, ['checkout', '-q', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'main']);
  await mergeBranchIntoCurrent(repo, { branch: 'side' });
  return repo;
}

describe('conflict 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('无冲突时 getConflicts 返回空列表', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);

    const list = await getConflicts(repo);
    expect(list.conflicts).toEqual([]);
  });

  it('冲突合并后 getConflicts 列出冲突路径与阶段', async () => {
    const repo = await repoInConflictedMerge();

    const list = await getConflicts(repo);
    expect(list.conflicts).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);
  });

  it('getConflictContents 返回 base/ours/theirs 三版本内容', async () => {
    const repo = await repoInConflictedMerge();

    const contents = await getConflictContents(repo, 'a.txt');
    expect(contents).toEqual({ path: 'a.txt', base: 'base\n', ours: 'main\n', theirs: 'side\n' });
  });

  it('resolveConflict ours 采纳当前分支版本并返回刷新列表', async () => {
    const repo = await repoInConflictedMerge();

    const list = await resolveConflict(repo, { strategy: 'ours', path: 'a.txt' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('main\n');
    expect(list.conflicts).toEqual([]);
  });

  it('resolveConflict theirs 采纳合并来源版本并返回刷新列表', async () => {
    const repo = await repoInConflictedMerge();

    const list = await resolveConflict(repo, { strategy: 'theirs', path: 'a.txt' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('side\n');
    expect(list.conflicts).toEqual([]);
  });

  it('resolveConflict manual 写入自定义内容并返回刷新列表', async () => {
    const repo = await repoInConflictedMerge();

    const list = await resolveConflict(repo, { strategy: 'manual', path: 'a.txt', content: 'resolved\n' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('resolved\n');
    expect(list.conflicts).toEqual([]);
  });

  it('resolveConflict 对非冲突路径 → INVALID_QUERY', async () => {
    const repo = await repoInConflictedMerge();

    await expect(resolveConflict(repo, { strategy: 'manual', path: 'ghost.txt', content: 'x' })).rejects.toMatchObject(
      {
        code: 'INVALID_QUERY',
        message: expect.stringContaining('该文件没有冲突'),
      },
    );
    // ours/theirs 同样先校验
    await expect(resolveConflict(repo, { strategy: 'ours', path: 'ghost.txt' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
    });
  });
});
