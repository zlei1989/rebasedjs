/** merge 原语测试：快进/已最新/冲突/no-ff 合并提交/continueMerge（含 squash 退化提交）。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { continueMerge, mergeBranch } from './merge';
import { getOperationState } from './operation';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 建临时仓库并入册（afterAll 统一清理） */
function makeRepo(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  return repo;
}

/** 夹具无初始提交：造 base 提交（a.txt 单行），返回默认分支名（随 git 版本不同，动态取值） */
async function makeBaseCommit(repo: string): Promise<string> {
  const { stdout } = await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo });
  const main = stdout.trim();
  await writeFile(join(repo, 'a.txt'), 'base\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'base'], { cwd: repo });
  return main;
}

/** 快进场景：base 后建 side 分支多一笔提交（新增 b.txt），回到主分支 */
async function makeFfScenario(repo: string): Promise<void> {
  const main = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  await writeFile(join(repo, 'b.txt'), 'side\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'side'], { cwd: repo });
  await runGit(['checkout', main], { cwd: repo });
}

/** 冲突场景：base → side 改 a.txt 同一行 → 回主分支改同一行（合并 recipe 来自计划夹具事实） */
async function makeConflictScenario(repo: string): Promise<void> {
  const main = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  await writeFile(join(repo, 'a.txt'), 'side\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'side'], { cwd: repo });
  await runGit(['checkout', main], { cwd: repo });
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'main'], { cwd: repo });
}

describe('merge 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('快进合并返回 success 且 HEAD 前进到 side', async () => {
    const repo = makeRepo();
    await makeFfScenario(repo);

    const result = await mergeBranch(repo, { branch: 'side' });
    expect(result.status).toBe('success');
    expect(result.stdout).toContain('Fast-forward');
    const { stdout } = await runGit(['rev-parse', 'HEAD', 'side'], { cwd: repo });
    const [head, side] = stdout.trim().split('\n');
    expect(head).toBe(side);
  });

  it('重复合并返回 up-to-date', async () => {
    const repo = makeRepo();
    await makeFfScenario(repo);
    await mergeBranch(repo, { branch: 'side' });

    const result = await mergeBranch(repo, { branch: 'side' });
    expect(result.status).toBe('up-to-date');
    expect(result.stdout).toContain('Already up to date');
  });

  it('冲突合并返回 conflicts 且操作态为 merge', async () => {
    const repo = makeRepo();
    await makeConflictScenario(repo);

    const result = await mergeBranch(repo, { branch: 'side' });
    expect(result.status).toBe('conflicts');
    expect(result.stdout).toContain('CONFLICT');
    expect((await getOperationState(repo)).kind).toBe('merge');
  });

  it('非 0 退出且无 MERGE_HEAD（分支不存在）原样抛 GitExitError', async () => {
    const repo = makeRepo();
    await makeBaseCommit(repo);

    await expect(mergeBranch(repo, { branch: 'ghost' })).rejects.toBeInstanceOf(GitExitError);
    expect((await getOperationState(repo)).kind).toBe('none');
  });

  it('noFf 快进场景产双父合并提交', async () => {
    const repo = makeRepo();
    await makeFfScenario(repo);

    const result = await mergeBranch(repo, { branch: 'side', noFf: true });
    expect(result.status).toBe('success');
    const { stdout } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    expect(stdout.trim().split(' ')).toHaveLength(2);
  });

  it('continueMerge 解决冲突后产合并提交且操作态回到 none（服务端无 TTY，不开编辑器）', async () => {
    const repo = makeRepo();
    await makeConflictScenario(repo);
    expect((await mergeBranch(repo, { branch: 'side' })).status).toBe('conflicts');

    // 手工解决：写最终内容 + add 标记已解决
    await writeFile(join(repo, 'a.txt'), 'resolved\n');
    await runGit(['add', 'a.txt'], { cwd: repo });
    await continueMerge(repo);

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    const { stdout } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    expect(stdout.trim().split(' ')).toHaveLength(2);
  });

  it('squash 合并不产提交也不进合并态，continueMerge 退化为 git commit 产单父提交', async () => {
    const repo = makeRepo();
    await makeFfScenario(repo);

    const result = await mergeBranch(repo, { branch: 'side', squash: true });
    expect(result.status).toBe('success');
    // squash 无 MERGE_HEAD，仅有 MERGE_MSG：continueMerge 走 git commit 退化路径
    expect((await getOperationState(repo)).kind).toBe('none');
    await continueMerge(repo);

    const { stdout: parents } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    // squash 产普通单父提交（非合并提交）
    expect(parents.trim().split(' ')).toHaveLength(1);
    const { stdout: content } = await runGit(['show', 'HEAD:b.txt'], { cwd: repo });
    expect(content).toBe('side\n');
  });
});
