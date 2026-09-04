/** rebase 原语测试：onto 成功/已最新/冲突、TODO 列表、交互式（drop/squash/fixup/reword/重排）、继续变基。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';
import { continueRebase, listTodoCommits, rebaseOnto, runInteractiveRebase } from './rebase';
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

/** 造一笔提交：写入 file:content 并 commit -m msg，返回提交哈希 */
async function makeCommit(repo: string, file: string, content: string, msg: string): Promise<string> {
  await writeFile(join(repo, file), content);
  await runGit(['add', file], { cwd: repo });
  await runGit(['commit', '-m', msg], { cwd: repo });
  return (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
}

/** 三提交装置：base（a.txt）之上依次 one/two/three（各自新增一个文件），返回 base 哈希与提交哈希数组 */
async function makeThreeCommitRepo(repo: string): Promise<{ branch: string; base: string; commits: string[] }> {
  const branch = await makeBaseCommit(repo);
  const base = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const commits: string[] = [];
  commits.push(await makeCommit(repo, 'one.txt', 'one\n', 'one'));
  commits.push(await makeCommit(repo, 'two.txt', 'two\n', 'two'));
  commits.push(await makeCommit(repo, 'three.txt', 'three\n', 'three'));
  return { branch, base, commits };
}

/** 冲突装置：base → side 改 a.txt 同一行 → 回主分支再改同一行（合并配方来自 P2-A/P2-E） */
async function makeRebaseConflict(repo: string): Promise<{ branch: string; side: string; main: string }> {
  const branch = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  const side = await makeCommit(repo, 'a.txt', 'side\n', 'side');
  await runGit(['checkout', branch], { cwd: repo });
  const main = await makeCommit(repo, 'a.txt', 'main\n', 'main');
  return { branch, side, main };
}

/** 当前 HEAD 的主题列表（新→旧） */
async function headSubjects(repo: string, count: number): Promise<string[]> {
  const { stdout } = await runGit(['log', '--format=%s', `-${count}`], { cwd: repo });
  return stdout.trim().split('\n');
}

describe('rebaseOnto', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('side 分支领先：main 上 rebase onto side → success 且历史线性（main 提交重放到 side 之上）', async () => {
    const repo = makeRepo();
    const branch = await makeBaseCommit(repo);
    await runGit(['checkout', '-b', 'side'], { cwd: repo });
    await makeCommit(repo, 'side.txt', 'side\n', 'side');
    await runGit(['checkout', branch], { cwd: repo });
    await makeCommit(repo, 'main.txt', 'main\n', 'main');

    const result = await rebaseOnto(repo, { onto: 'side' });
    expect(result.status).toBe('success');

    // 线性：main' → side → base（无合并提交），且两文件都在 HEAD 树中
    expect(await headSubjects(repo, 3)).toEqual(['main', 'side', 'base']);
    const { stdout: parents } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    expect(parents.trim().split(' ')).toHaveLength(1);
    expect((await runGit(['show', 'HEAD:side.txt'], { cwd: repo })).stdout).toBe('side\n');
    expect((await runGit(['show', 'HEAD:main.txt'], { cwd: repo })).stdout).toBe('main\n');
  });

  it('onto 为当前分支、无变化 → up-to-date 且 HEAD 未移动', async () => {
    const repo = makeRepo();
    const { branch } = await makeThreeCommitRepo(repo);
    const before = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    const result = await rebaseOnto(repo, { onto: branch });
    expect(result.status).toBe('up-to-date');
    expect((await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()).toBe(before);
  });

  it('双向改同一行 → conflicts 且操作态为 rebase（含 step/total）', async () => {
    const repo = makeRepo();
    await makeRebaseConflict(repo);

    const result = await rebaseOnto(repo, { onto: 'side' });
    expect(result.status).toBe('conflicts');
    // merge 后端写 rebase-merge/msgnum+end：重放 1 笔提交时冲突在第 1 步
    expect(await getOperationState(repo)).toEqual({ kind: 'rebase', step: 1, total: 1 });
  });

  it('无效 onto 原样抛 GitExitError 且不进入 rebase 态', async () => {
    const repo = makeRepo();
    await makeBaseCommit(repo);

    await expect(rebaseOnto(repo, { onto: 'ghost' })).rejects.toBeInstanceOf(GitExitError);
    expect((await getOperationState(repo)).kind).toBe('none');
  });
});

describe('listTodoCommits', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('反序（旧→新）返回 base..HEAD 全量提交，哈希与主题一一对应', async () => {
    const repo = makeRepo();
    const { base, commits } = await makeThreeCommitRepo(repo);

    const todo = await listTodoCommits(repo, base);
    expect(todo).toEqual([
      { hash: commits[0], subject: 'one' },
      { hash: commits[1], subject: 'two' },
      { hash: commits[2], subject: 'three' },
    ]);
  });
});

describe('runInteractiveRebase', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('三提交 pick 中间 drop → 中间提交消失，前后两提交保留', async () => {
    const repo = makeRepo();
    const { base, commits } = await makeThreeCommitRepo(repo);

    const result = await runInteractiveRebase(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[1], action: 'drop' },
        { hash: commits[2], action: 'pick' },
      ],
    });
    expect(result.status).toBe('success');

    expect(await headSubjects(repo, 3)).toEqual(['three', 'one', 'base']);
    const { stdout: ls } = await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo });
    expect(ls.split('\n')).toContain('one.txt');
    expect(ls.split('\n')).not.toContain('two.txt');
  });

  it('两提交 squash → 合并为一笔（base..HEAD 仅 1 提交，单父）', async () => {
    const repo = makeRepo();
    const { base, commits } = await makeThreeCommitRepo(repo);

    const result = await runInteractiveRebase(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[1], action: 'squash' },
      ],
    });
    expect(result.status).toBe('success');

    const { stdout: count } = await runGit(['rev-list', '--count', `${base}..HEAD`], { cwd: repo });
    expect(count.trim()).toBe('1');
    const { stdout: parents } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    expect(parents.trim().split(' ')).toHaveLength(1);
  });

  it('fixup 并入上一提交 → 合并为一笔且主题沿用被并入提交', async () => {
    const repo = makeRepo();
    const { base, commits } = await makeThreeCommitRepo(repo);

    const result = await runInteractiveRebase(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[1], action: 'fixup' },
      ],
    });
    expect(result.status).toBe('success');

    const { stdout: count } = await runGit(['rev-list', '--count', `${base}..HEAD`], { cwd: repo });
    expect(count.trim()).toBe('1');
    // fixup 不产生独立消息，主题恒为被并入提交的 'one'
    const { stdout: subject } = await runGit(['log', '--format=%s', '-1'], { cwd: repo });
    expect(subject.trim()).toBe('one');
  });

  it('reword 在 core.editor=true 防护下不改信息 → 结果等于 pick', async () => {
    const repo = makeRepo();
    const { base, commits } = await makeThreeCommitRepo(repo);

    const result = await runInteractiveRebase(repo, {
      base,
      entries: [{ hash: commits[0], action: 'reword' }],
    });
    expect(result.status).toBe('success');
    expect(await headSubjects(repo, 2)).toEqual(['one', 'base']);
  });

  it('重排：两提交交换 → log 顺序反转（先应用 two 再 one）', async () => {
    const repo = makeRepo();
    const { base, commits } = await makeThreeCommitRepo(repo);

    const result = await runInteractiveRebase(repo, {
      base,
      entries: [
        { hash: commits[1], action: 'pick' },
        { hash: commits[0], action: 'pick' },
      ],
    });
    expect(result.status).toBe('success');
    expect(await headSubjects(repo, 3)).toEqual(['one', 'two', 'base']);
  });
});

describe('continueRebase', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('冲突解决后继续 → 完成变基且操作态回到 none', async () => {
    const repo = makeRepo();
    await makeRebaseConflict(repo);
    expect((await rebaseOnto(repo, { onto: 'side' })).status).toBe('conflicts');

    // 手工解决：写最终内容 + add 标记已解决
    await writeFile(join(repo, 'a.txt'), 'resolved\n');
    await runGit(['add', 'a.txt'], { cwd: repo });
    await continueRebase(repo);

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    expect(await headSubjects(repo, 3)).toEqual(['main', 'side', 'base']);
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('resolved\n');
  });
});
