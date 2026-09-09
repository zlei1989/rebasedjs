/** rebase 原语测试：onto 成功/已最新/冲突、TODO 列表、交互式（drop/squash/fixup/reword/重排）、继续变基、auto-squash。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';
import { autosquashCommit, continueRebase, editCommitAction, listTodoCommits, rebaseOnto, runInteractiveRebase, skipRebase } from './rebase';
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

  it('skipRebase：冲突时跳过当前提交（其变更被丢弃），继续后续提交且操作态回到 none', async () => {
    const repo = makeRepo();
    await makeRebaseConflict(repo);
    expect((await rebaseOnto(repo, { onto: 'side' })).status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('rebase');

    await skipRebase(repo);

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    // 变基链重放到 side 之上（main 提交被跳过——冲突提交放弃，无合并提交）
    expect(await headSubjects(repo, 2)).toEqual(['side', 'base']);
  });
});

describe('autosquashCommit（fixup!/squash! 折入，GitAutoSquashCommitAction 语义）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  /** 三提交装置：a.txt/b.txt/c.txt 各一提交（c1/c2/c3），返回 c1 哈希 */
  async function makeRepo3(repo: string): Promise<{ base: string }> {
    const base = await makeCommit(repo, 'a.txt', 'v1\n', 'c1');
    await makeCommit(repo, 'b.txt', 'b1\n', 'c2');
    await makeCommit(repo, 'c.txt', 'c1\n', 'c3');
    return { base };
  }

  it('fixup：暂存改动折入同主题目标提交（目标信息保留、提交数不变、后续提交原样）', async () => {
    const repo = makeRepo();
    const { base } = await makeRepo3(repo);
    // 暂存 a.txt 改动（fixup 提交携带；a.txt 在目标提交树中存在）
    await writeFile(join(repo, 'a.txt'), 'v2\n');
    await runGit(['add', 'a.txt'], { cwd: repo });

    const result = await autosquashCommit(repo, { hash: base, action: 'fixup' });

    expect(result.status).toBe('success');
    // 提交数不变（fixup 折入 → 3 条）
    const count = (await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim();
    expect(count).toBe('3');
    // 目标提交信息保留（fixup 语义）；内容包含暂存改动
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    expect(subjects).toEqual(['c1', 'c2', 'c3']);
    const newBase = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[0];
    expect((await runGit(['show', `${newBase}:a.txt`], { cwd: repo })).stdout).toBe('v2\n');
    // 后续提交重放：最终树上 b.txt/c.txt 仍在
    expect((await runGit(['show', 'HEAD:b.txt'], { cwd: repo })).stdout).toBe('b1\n');
    expect((await runGit(['show', 'HEAD:c.txt'], { cwd: repo })).stdout).toBe('c1\n');
  });

  it('squash：目标提交信息 = 原信息（消息编辑器 shim 覆写 %B）、提交数不变', async () => {
    const repo = makeRepo();
    const { base } = await makeRepo3(repo);
    await writeFile(join(repo, 'a.txt'), 'v3\n');
    await runGit(['add', 'a.txt'], { cwd: repo });

    const result = await autosquashCommit(repo, { hash: base, action: 'squash' });

    expect(result.status).toBe('success');
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('3');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    // squash 后信息 = 目标提交原文（shim 覆写；无 "squash! " 前缀残留）
    expect(subjects).toEqual(['c1', 'c2', 'c3']);
    const newBase = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[0];
    expect((await runGit(['show', `${newBase}:a.txt`], { cwd: repo })).stdout).toBe('v3\n');
  });

  it('冲突：折入目标与中间提交同文件改动 → status conflicts（rebase 冲突态）', async () => {
    const repo = makeRepo();
    await makeCommit(repo, 'a.txt', 'v1\n', 'c1');
    await makeCommit(repo, 'a.txt', 'v2\n', 'c2');
    await makeCommit(repo, 'a.txt', 'v3\n', 'c3');
    const c1 = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[0];
    // 暂存 v3→v4：fixup 提交 diff（v3 上下文）折入目标（v1）→ context 不匹配冲突
    await writeFile(join(repo, 'a.txt'), 'v4\n');
    await runGit(['add', 'a.txt'], { cwd: repo });

    const result = await autosquashCommit(repo, { hash: c1, action: 'fixup' });

    expect(result.status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('rebase');
  });

  it('无暂存内容：git commit 报错透出（GitExitError）', async () => {
    const repo = makeRepo();
    const { base } = await makeRepo3(repo);

    await expect(autosquashCommit(repo, { hash: base, action: 'fixup' })).rejects.toMatchObject({
      name: 'GitExitError',
    });
  });
});

describe('editCommitAction（GitSingleCommitEditingAction 语义：reword/drop/squash/fixup 直通）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  /** 三提交装置：c1（a.txt）/c2（b.txt）/c3（c.txt），返回 c1..c3 哈希 */
  async function makeRepo3(repo: string): Promise<string[]> {
    const c1 = await makeCommit(repo, 'a.txt', 'v1\n', 'c1');
    const c2 = await makeCommit(repo, 'b.txt', 'b1\n', 'c2');
    const c3 = await makeCommit(repo, 'c.txt', 'c1\n', 'c3');
    return [c1, c2, c3];
  }

  it('reword：目标提交信息重写（消息 shim 覆写）、其余提交原样、提交数不变', async () => {
    const repo = makeRepo();
    const [, c2] = await makeRepo3(repo);

    const result = await editCommitAction(repo, { hash: c2, action: 'reword', message: 'c2（重写）' });

    expect(result.status).toBe('success');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    expect(subjects).toEqual(['c1', 'c2（重写）', 'c3']);
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('3');
    // 重写后的提交树不变（b.txt 仍在）
    const newC2 = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[1];
    expect((await runGit(['show', `${newC2}:b.txt`], { cwd: repo })).stdout).toBe('b1\n');
  });

  it('drop：目标提交消失（变更一并丢弃）、其余提交原样、提交数 -1', async () => {
    const repo = makeRepo();
    const [, c2] = await makeRepo3(repo);

    const result = await editCommitAction(repo, { hash: c2, action: 'drop' });

    expect(result.status).toBe('success');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    expect(subjects).toEqual(['c1', 'c3']);
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('2');
    expect((await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo })).stdout).not.toContain('b.txt');
  });

  it('fixup：目标并入父提交（提交数 -1、父主题保留、内容合并）', async () => {
    const repo = makeRepo();
    const c1 = await makeCommit(repo, 'a.txt', 'v1\n', 'c1');
    const c2 = await makeCommit(repo, 'b.txt', 'b1\n', 'c2');

    const result = await editCommitAction(repo, { hash: c2, action: 'fixup' });

    expect(result.status).toBe('success');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    // fixup 并入父：提交数 -1，父（c1）信息保留
    expect(subjects).toEqual(['c1']);
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('1');
    expect((await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo })).stdout).toContain('b.txt');
    void c1;
  });
});
