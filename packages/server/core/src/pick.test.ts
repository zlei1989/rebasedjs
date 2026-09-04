/** 摘樱桃/还原原语测试：success/conflicts 两态及 continuePick 解决后完成。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runGit } from './exec';
import { getOperationState } from './operation';
import { cherryPickCommits, continuePick, revertCommits } from './pick';
import { resetToRef } from './reset';
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

/** 多提交装置：base 之上依次 one（改 a.txt）/two（新增 c.txt），返回 base 哈希与提交 */
async function makePickRepo(repo: string): Promise<{ base: string; one: string; two: string }> {
  await makeBaseCommit(repo);
  const base = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const one = await makeCommit(repo, 'a.txt', 'one\n', 'one');
  const two = await makeCommit(repo, 'c.txt', 'two\n', 'two');
  return { base, one, two };
}

/** 冲突装置：base → one 改 a.txt → 硬复位 base → 本地再改 a.txt（手工造同期改动） */
async function makePickConflict(repo: string): Promise<{ base: string; one: string }> {
  await makeBaseCommit(repo);
  const base = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const one = await makeCommit(repo, 'a.txt', 'one\n', 'one');
  await resetToRef(repo, base, 'hard');
  await makeCommit(repo, 'a.txt', 'local\n', 'local');
  return { base, one };
}

describe('cherryPickCommits', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('多提交依次摘樱桃 → success 且顺序正确、文件落位', async () => {
    const repo = makeRepo();
    const { base, one, two } = await makePickRepo(repo);
    await resetToRef(repo, base, 'hard');

    const result = await cherryPickCommits(repo, [one, two]);
    expect(result.status).toBe('success');

    const { stdout: subjects } = await runGit(['log', '--format=%s', '-3'], { cwd: repo });
    expect(subjects.trim().split('\n')).toEqual(['two', 'one', 'base']);
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('one\n');
    expect((await runGit(['show', 'HEAD:c.txt'], { cwd: repo })).stdout).toBe('two\n');
  });

  it('同期改动 → conflicts 且操作态为 cherry-pick；continuePick 解决后完成', async () => {
    const repo = makeRepo();
    const { one } = await makePickConflict(repo);

    const result = await cherryPickCommits(repo, [one]);
    expect(result.status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('cherry-pick');

    await writeFile(join(repo, 'a.txt'), 'resolved\n');
    await runGit(['add', 'a.txt'], { cwd: repo });
    await continuePick(repo, 'cherry-pick');

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    const { stdout: subject } = await runGit(['log', '--format=%s', '-1'], { cwd: repo });
    expect(subject.trim()).toBe('one');
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('resolved\n');
  });
});

describe('revertCommits', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('还原祖先提交 → success，生成 Revert 提交且内容回到被还原前', async () => {
    const repo = makeRepo();
    const { one } = await makePickRepo(repo);

    const result = await revertCommits(repo, [one]);
    expect(result.status).toBe('success');

    const { stdout: subject } = await runGit(['log', '--format=%s', '-1'], { cwd: repo });
    expect(subject.trim()).toBe('Revert "one"');
    // one 把 a.txt base→one，还原后 a.txt 回 base；c.txt（two 所加）不受影响
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('base\n');
    expect((await runGit(['show', 'HEAD:c.txt'], { cwd: repo })).stdout).toBe('two\n');
  });

  it('同期改动 → conflicts 且操作态为 revert；continuePick 解决后完成', async () => {
    const repo = makeRepo();
    const { one } = await makePickConflict(repo);

    const result = await revertCommits(repo, [one]);
    expect(result.status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('revert');

    // 还原意图是 a.txt 回 base；手工以 base 内容解决
    await writeFile(join(repo, 'a.txt'), 'base\n');
    await runGit(['add', 'a.txt'], { cwd: repo });
    await continuePick(repo, 'revert');

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    const { stdout: subject } = await runGit(['log', '--format=%s', '-1'], { cwd: repo });
    expect(subject.trim()).toBe('Revert "one"');
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('base\n');
  });
});
