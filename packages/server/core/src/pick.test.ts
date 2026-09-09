/** 摘樱桃/还原原语测试：success/conflicts 两态、空补丁停态、isAncestor 预检及 continuePick 解决后完成。
 *  性能：2 种夹具形状在 beforeAll 各建一次模板，用例经 instantiateFixture 复制（0 spawn）。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listConflictedPaths } from './conflict';
import { GitExitError, runGit } from './exec';
import { abortGitOperation, getOperationState } from './operation';
import { cherryPickCommits, continuePick, isAncestor, revertCommits } from './pick';
import { resetToRef } from './reset';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
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

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let pickTemplate = '';
let pick: { base: string; one: string; two: string } = { base: '', one: '', two: '' };
let pickConflictTemplate = '';
let pickConflict: { base: string; one: string } = { base: '', one: '' };

beforeAll(async () => {
  pickTemplate = createTmpRepo();
  pick = await makePickRepo(pickTemplate);
  pickConflictTemplate = createTmpRepo();
  pickConflict = await makePickConflict(pickConflictTemplate);
  templateDirs.push(pickTemplate, pickConflictTemplate);
});

describe('cherryPickCommits', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('多提交依次摘樱桃 → success 且顺序正确、文件落位', async () => {
    const repo = instantiate(pickTemplate);
    await resetToRef(repo, pick.base, 'hard');

    const result = await cherryPickCommits(repo, [pick.one, pick.two]);
    expect(result.status).toBe('success');

    const { stdout: subjects } = await runGit(['log', '--format=%s', '-3'], { cwd: repo });
    expect(subjects.trim().split('\n')).toEqual(['two', 'one', 'base']);
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('one\n');
    expect((await runGit(['show', 'HEAD:c.txt'], { cwd: repo })).stdout).toBe('two\n');
  });

  it('同期改动 → conflicts 且操作态为 cherry-pick；continuePick 解决后完成', async () => {
    const repo = instantiate(pickConflictTemplate);

    const result = await cherryPickCommits(repo, [pickConflict.one]);
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

  it('祖先提交摘樱桃（空补丁停态）→ 不判 conflicts，原样抛 GitExitError', async () => {
    const repo = instantiate(pickTemplate); // HEAD 在 one 之上，one 为祖先

    // git 留 CHERRY_PICK_HEAD 但 ls-files -u 为空：仅凭操作态归类 conflicts 会把空补丁
    // 误判为冲突（UI 无限「继续」循环）；正确行为是原样抛 GitExitError（api 层有 isAncestor 预检兜底）
    await expect(cherryPickCommits(repo, [pick.one])).rejects.toBeInstanceOf(GitExitError);
    expect((await getOperationState(repo)).kind).toBe('cherry-pick');
    expect(await listConflictedPaths(repo)).toEqual([]);
    // 清理空补丁停态，避免残留
    await abortGitOperation(repo, 'cherry-pick');
  });
});

describe('isAncestor', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('祖先提交 → true；head 自身 → true；非祖先（已脱离历史）→ false；无效 ref 抛 GitExitError', async () => {
    const repo = instantiate(pickTemplate);

    expect(await isAncestor(repo, pick.one)).toBe(true);
    expect(await isAncestor(repo, 'HEAD')).toBe(true);

    await resetToRef(repo, pick.base, 'hard');
    expect(await isAncestor(repo, pick.one)).toBe(false);

    await expect(isAncestor(repo, 'ghost')).rejects.toBeInstanceOf(GitExitError);
  });
});

describe('revertCommits', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('还原祖先提交 → success，生成 Revert 提交且内容回到被还原前', async () => {
    const repo = instantiate(pickTemplate);

    const result = await revertCommits(repo, [pick.one]);
    expect(result.status).toBe('success');

    const { stdout: subject } = await runGit(['log', '--format=%s', '-1'], { cwd: repo });
    expect(subject.trim()).toBe('Revert "one"');
    // one 把 a.txt base→one，还原后 a.txt 回 base；c.txt（two 所加）不受影响
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('base\n');
    expect((await runGit(['show', 'HEAD:c.txt'], { cwd: repo })).stdout).toBe('two\n');
  });

  it('同期改动 → conflicts 且操作态为 revert；continuePick 解决后完成', async () => {
    const repo = instantiate(pickConflictTemplate);

    const result = await revertCommits(repo, [pickConflict.one]);
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
