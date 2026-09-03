/** operation 原语测试：标记文件检测（真实 merge 冲突造 MERGE_HEAD）+ rebase 进度解析 + 中止回环 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from './exec';
import { abortGitOperation, getOperationState } from './operation';
import { createTmpRepo, cleanupTmpRepo } from './testing/tmp-repo';

describe('operation 原语', () => {
  let repo: string;
  beforeEach(() => { repo = createTmpRepo(); });
  afterEach(() => { cleanupTmpRepo(repo); });

  it('干净仓库为 none', async () => {
    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
  });

  it('merge 冲突时检测为 merge，abort 后回到 none', async () => {
    // fixture 无首个提交且默认分支名随 git 版本不同：先取分支名并造 base 提交，再分 side 改同一行造冲突
    const { stdout: br } = await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo });
    const main = br.trim();
    await writeFile(join(repo, 'a.txt'), 'base\n');
    await runGit(['add', '.'], { cwd: repo });
    await runGit(['commit', '-m', 'base'], { cwd: repo });
    await runGit(['checkout', '-b', 'side'], { cwd: repo });
    await writeFile(join(repo, 'a.txt'), 'side\n');
    await runGit(['add', '.'], { cwd: repo });
    await runGit(['commit', '-m', 'side'], { cwd: repo });
    await runGit(['checkout', main], { cwd: repo });
    await writeFile(join(repo, 'a.txt'), 'main\n');
    await runGit(['add', '.'], { cwd: repo });
    await runGit(['commit', '-m', 'main'], { cwd: repo });
    await runGit(['merge', 'side'], { cwd: repo }).catch(() => {});
    expect((await getOperationState(repo)).kind).toBe('merge');
    await abortGitOperation(repo, 'merge');
    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
  });

  it('rebase-merge 目录给出 step/total 进度', async () => {
    const { stdout } = await runGit(['rev-parse', '--absolute-git-dir'], { cwd: repo });
    const dir = join(stdout.trim(), 'rebase-merge');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'msgnum'), '2\n');
    await writeFile(join(dir, 'end'), '5\n');
    expect(await getOperationState(repo)).toEqual({ kind: 'rebase', step: 2, total: 5 });
  });
});
