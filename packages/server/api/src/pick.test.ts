/** 摘樱桃/还原功能测试：success/conflicts 两态、无效哈希 INVALID_REF 预检、进行中操作预检。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cherryPick, revert } from './pick';
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

describe('cherryPick', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('多提交依次摘樱桃 → success 且顺序正确、文件落位', async () => {
    const repo = makeRepo();
    const { base, one, two } = makePickRepo(repo);
    git(repo, ['reset', '-q', '--hard', base]);

    const outcome = await cherryPick(repo, { hashes: [one, two] });
    expect(outcome.status).toBe('success');
    expect(git(repo, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['two', 'one', 'base']);
    expect(git(repo, ['show', 'HEAD:a.txt'])).toBe('one\n');
    expect(git(repo, ['show', 'HEAD:c.txt'])).toBe('two\n');
  });

  it('同期改动 → conflicts', async () => {
    const repo = makeRepo();
    const { one } = makePickConflict(repo);

    const outcome = await cherryPick(repo, { hashes: [one] });
    expect(outcome.status).toBe('conflicts');
  });

  it('哈希无效 → INVALID_REF（引用不存在或不是提交）', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);

    await expect(cherryPick(repo, { hashes: ['ghost'] })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '引用不存在或不是提交：ghost',
    });
  });

  it('已有进行中操作 → OPERATION_IN_PROGRESS', async () => {
    const repo = makeRepo();
    const { one } = makePickConflict(repo);
    await cherryPick(repo, { hashes: [one] }); // 进入 cherry-pick 冲突态

    await expect(cherryPick(repo, { hashes: [one] })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
  });
});

describe('revert', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('还原祖先提交 → success，生成 Revert 提交且内容回到被还原前', async () => {
    const repo = makeRepo();
    const { one } = makePickRepo(repo);

    const outcome = await revert(repo, { hashes: [one] });
    expect(outcome.status).toBe('success');
    expect(git(repo, ['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(git(repo, ['show', 'HEAD:a.txt'])).toBe('base\n');
  });

  it('同期改动 → conflicts', async () => {
    const repo = makeRepo();
    const { one } = makePickConflict(repo);

    const outcome = await revert(repo, { hashes: [one] });
    expect(outcome.status).toBe('conflicts');
  });

  it('哈希无效 → INVALID_REF（引用不存在或不是提交）', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);

    await expect(revert(repo, { hashes: ['ghost'] })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '引用不存在或不是提交：ghost',
    });
  });

  it('已有进行中操作（merge 冲突态互斥）→ OPERATION_IN_PROGRESS', async () => {
    const repo = makeRepo();
    // 用 merge 冲突造进行中操作（与 cherry-pick/revert 无关的操作态也要被拦截）
    const main = makeBaseCommit(repo);
    git(repo, ['checkout', '-q', '-b', 'side']);
    makeCommit(repo, 'a.txt', 'side\n', 'side');
    git(repo, ['checkout', '-q', main]);
    makeCommit(repo, 'a.txt', 'main\n', 'main');
    try {
      git(repo, ['merge', 'side']);
    } catch {
      // merge 冲突以非零退出码结束，忽略
    }

    await expect(revert(repo, { hashes: ['HEAD'] })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
  });
});
