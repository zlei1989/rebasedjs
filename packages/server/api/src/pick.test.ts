/** 摘樱桃/还原功能测试：success/conflicts 两态、无效哈希 INVALID_REF 预检、祖先提交 INVALID_QUERY 预检、进行中操作预检。
 *  性能：4 种夹具形状（base/pick 多提交/pick 冲突/merge 冲突态）在 beforeAll 各建一次模板，用例经 instantiateFixture 复制（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cherryPick, revert } from './pick';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
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

/** 造一笔提交：写入 file:content 并 commit -m msg，返回提交哈希 */
function makeCommit(repo: string, file: string, content: string, msg: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', msg]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

/** 多提交装置：base 之上依次 one（改 a.txt）/two（新增 c.txt），返回 base 哈希与提交 */
function makePickRepo(repo: string): { base: string; one: string; two: string } {
  makeBaseCommit(repo);
  const base = git(repo, ['rev-parse', 'HEAD']).trim();
  const one = makeCommit(repo, 'a.txt', 'one\n', 'one');
  const two = makeCommit(repo, 'c.txt', 'two\n', 'two');
  return { base, one, two };
}

/** 冲突装置：base → one 改 a.txt → 硬复位 base → 本地再改 a.txt（手工造同期改动） */
function makePickConflict(repo: string): { base: string; one: string } {
  makeBaseCommit(repo);
  const base = git(repo, ['rev-parse', 'HEAD']).trim();
  const one = makeCommit(repo, 'a.txt', 'one\n', 'one');
  git(repo, ['reset', '-q', '--hard', base]);
  makeCommit(repo, 'a.txt', 'local\n', 'local');
  return { base, one };
}

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';
let pickTemplate = '';
let pick: { base: string; one: string; two: string } = { base: '', one: '', two: '' };
let pickConflictTemplate = '';
let pickConflict: { base: string; one: string } = { base: '', one: '' };
let mergeConflictTemplate = '';

beforeAll(() => {
  baseTemplate = createTmpRepo();
  makeBaseCommit(baseTemplate);
  pickTemplate = createTmpRepo();
  pick = makePickRepo(pickTemplate);
  pickConflictTemplate = createTmpRepo();
  pickConflict = makePickConflict(pickConflictTemplate);
  // merge 冲突态（与 cherry-pick/revert 无关的操作态也要被拦截）
  mergeConflictTemplate = createTmpRepo();
  const main = makeBaseCommit(mergeConflictTemplate);
  git(mergeConflictTemplate, ['checkout', '-q', '-b', 'side']);
  makeCommit(mergeConflictTemplate, 'a.txt', 'side\n', 'side');
  git(mergeConflictTemplate, ['checkout', '-q', main]);
  makeCommit(mergeConflictTemplate, 'a.txt', 'main\n', 'main');
  try {
    git(mergeConflictTemplate, ['merge', 'side']);
  } catch {
    // merge 冲突以非零退出码结束，忽略
  }
  templateDirs.push(baseTemplate, pickTemplate, pickConflictTemplate, mergeConflictTemplate);
});

describe('cherryPick', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('多提交依次摘樱桃 → success 且顺序正确、文件落位', async () => {
    const repo = instantiate(pickTemplate);
    git(repo, ['reset', '-q', '--hard', pick.base]);

    const outcome = await cherryPick(repo, { hashes: [pick.one, pick.two] });
    expect(outcome.status).toBe('success');
    expect(git(repo, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['two', 'one', 'base']);
    expect(git(repo, ['show', 'HEAD:a.txt'])).toBe('one\n');
    expect(git(repo, ['show', 'HEAD:c.txt'])).toBe('two\n');
  });

  it('同期改动 → conflicts', async () => {
    const repo = instantiate(pickConflictTemplate);

    const outcome = await cherryPick(repo, { hashes: [pickConflict.one] });
    expect(outcome.status).toBe('conflicts');
  });

  it('哈希无效 → INVALID_REF（引用不存在或不是提交）', async () => {
    const repo = instantiate(baseTemplate);

    await expect(cherryPick(repo, { hashes: ['ghost'] })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '引用不存在或不是提交：ghost',
    });
  });

  it('祖先提交（已在当前分支历史中）→ INVALID_QUERY 空补丁预检，且不留下停态', async () => {
    const repo = instantiate(pickTemplate); // HEAD 在 one 之上，one 为祖先

    await expect(cherryPick(repo, { hashes: [pick.one] })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '该提交已在当前分支历史中，无需摘樱桃',
    });
    // 预检在 git 创建空补丁停态之前拦下
    expect(existsSync(join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('已有进行中操作 → OPERATION_IN_PROGRESS', async () => {
    const repo = instantiate(pickConflictTemplate);
    await cherryPick(repo, { hashes: [pickConflict.one] }); // 进入 cherry-pick 冲突态

    await expect(cherryPick(repo, { hashes: [pickConflict.one] })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
  });
});

describe('revert', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('还原祖先提交 → success，生成 Revert 提交且内容回到被还原前', async () => {
    const repo = instantiate(pickTemplate);

    const outcome = await revert(repo, { hashes: [pick.one] });
    expect(outcome.status).toBe('success');
    expect(git(repo, ['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(git(repo, ['show', 'HEAD:a.txt'])).toBe('base\n');
  });

  it('同期改动 → conflicts', async () => {
    const repo = instantiate(pickConflictTemplate);

    const outcome = await revert(repo, { hashes: [pickConflict.one] });
    expect(outcome.status).toBe('conflicts');
  });

  it('哈希无效 → INVALID_REF（引用不存在或不是提交）', async () => {
    const repo = instantiate(baseTemplate);

    await expect(revert(repo, { hashes: ['ghost'] })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '引用不存在或不是提交：ghost',
    });
  });

  it('已有进行中操作（merge 冲突态互斥）→ OPERATION_IN_PROGRESS', async () => {
    const repo = instantiate(mergeConflictTemplate);

    await expect(revert(repo, { hashes: ['HEAD'] })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
  });
});
