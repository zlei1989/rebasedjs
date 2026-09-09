/** operation 服务测试：真实 git CLI + 临时仓库，验证状态映射与无操作时 INVALID_QUERY 语义。
 *  性能：5 种冲突/干净态夹具在 beforeAll 各建一次模板，用例经 instantiateFixture 复制（0 spawn；
 *  历史每用例建仓 + 10-13 spawn 搭冲突态）。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServiceError } from '@rebased/contracts';
import { abortOperation, continueOperation, getOperation, skipOperation } from './operation';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args]);
}

/** git 快捷执行带回显（return stdout） */
function gitOut(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

/** 造 base/side/main 三提交（main 与 side 改同一行）：合并/变基冲突配方基础 */
function makeMergeScenario(repo: string): void {
  const main = execFileSync('git', ['-C', repo, 'symbolic-ref', 'HEAD', '--short']).toString().trim();
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'side']);
  git(repo, ['checkout', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'main']);
}

/** 造真实 merge 冲突：同 Task 2 手法，main 与 side 改同一行后 merge */
function createMergeConflict(repo: string): void {
  makeMergeScenario(repo);
  try {
    git(repo, ['merge', 'side']);
  } catch {
    // merge 冲突以非零退出码结束，忽略
  }
}

/** continueOperation 的冲突装置与 resolve 配方（同 Task 2 core 测试手法，造真实冲突态） */
function makeRebaseConflict(repo: string): void {
  makeMergeScenario(repo);
  try {
    git(repo, ['rebase', 'side']);
  } catch {
    // rebase 冲突以非零退出码结束，忽略
  }
}

/** pick 冲突装置：base → one 改 a.txt → 硬复位 base → 本地再改 a.txt（手工造同期改动） */
function makePickConflict(repo: string): string {
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const base = gitOut(repo, ['rev-parse', 'HEAD']).trim();
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'one']);
  const one = gitOut(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['reset', '-q', '--hard', base]);
  writeFileSync(join(repo, 'a.txt'), 'local\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'local']);
  return one;
}

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let emptyTemplate = '';
let mergeConflictTemplate = '';
let rebaseConflictTemplate = '';
let squashConflictTemplate = '';
let pickConflictTemplate = '';
let pickOne = '';

beforeAll(() => {
  emptyTemplate = createTmpRepo();
  mergeConflictTemplate = createTmpRepo();
  createMergeConflict(mergeConflictTemplate);
  rebaseConflictTemplate = createTmpRepo();
  makeRebaseConflict(rebaseConflictTemplate);
  squashConflictTemplate = createTmpRepo();
  makeMergeScenario(squashConflictTemplate);
  try {
    git(squashConflictTemplate, ['merge', '--squash', 'side']);
  } catch {
    // squash 冲突以非零退出码结束，忽略（不写 MERGE_HEAD）
  }
  pickConflictTemplate = createTmpRepo();
  pickOne = makePickConflict(pickConflictTemplate);
  templateDirs.push(emptyTemplate, mergeConflictTemplate, rebaseConflictTemplate, squashConflictTemplate, pickConflictTemplate);
});

/** 复制模板为独立夹具（conflict 态在 .git 内，随复制携带） */
function fresh(template: string): string {
  return instantiateFixture(template);
}

describe('operation 服务', () => {
  it('干净仓库 getOperation 返回 { kind: none }', async () => {
    const repo = fresh(emptyTemplate);
    expect(await getOperation(repo)).toEqual({ kind: 'none' });
    cleanupTmpRepo(repo);
  });

  it('无进行中操作时 abortOperation 抛 ServiceError(INVALID_QUERY)', async () => {
    const repo = fresh(emptyTemplate);
    await expect(abortOperation(repo)).rejects.toBeInstanceOf(ServiceError);
    await expect(abortOperation(repo)).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '当前没有进行中的操作',
    });
    cleanupTmpRepo(repo);
  });

  it('merge 冲突时检测为 merge，abort 后返回 { kind: none }', async () => {
    const repo = fresh(mergeConflictTemplate);
    expect((await getOperation(repo)).kind).toBe('merge');
    expect(await abortOperation(repo)).toEqual({ kind: 'none' });
    cleanupTmpRepo(repo);
  });
});

describe('continueOperation', () => {
  it('无进行中操作 → INVALID_QUERY 当前没有可继续的操作', async () => {
    const repo = fresh(emptyTemplate);
    await expect(continueOperation(repo)).rejects.toBeInstanceOf(ServiceError);
    await expect(continueOperation(repo)).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '当前没有可继续的操作',
    });
    cleanupTmpRepo(repo);
  });

  it('merge 冲突解决后 continue → 完成且返回刷新状态（双亲提交）', async () => {
    const repo = fresh(mergeConflictTemplate);
    writeFileSync(join(repo, 'a.txt'), 'resolved\n');
    git(repo, ['add', 'a.txt']);

    const status = await continueOperation(repo);
    expect(status.entries).toEqual([]);
    expect(gitOut(repo, ['rev-parse', 'HEAD']).trim()).toBe(status.headHash);
    expect(gitOut(repo, ['log', '--format=%P', '-1']).trim().split(' ')).toHaveLength(2);
    cleanupTmpRepo(repo);
  });

  it('squash 冲突全链：kind none 但 canContinueMerge 放行 → 单父提交（squash 退化不回归）', async () => {
    const repo = fresh(squashConflictTemplate);
    expect((await getOperation(repo)).kind).toBe('none'); // squash 不在合并态

    writeFileSync(join(repo, 'a.txt'), 'side\n');
    git(repo, ['add', 'a.txt']);
    const status = await continueOperation(repo);
    expect(status.entries).toEqual([]);
    expect(gitOut(repo, ['log', '--format=%P', '-1']).trim().split(' ')).toHaveLength(1);
    expect(gitOut(repo, ['show', 'HEAD:a.txt'])).toBe('side\n');
    cleanupTmpRepo(repo);
  });

  it('rebase 冲突解决后 continue → 完成（操作态回 none）', async () => {
    const repo = fresh(rebaseConflictTemplate);
    expect((await getOperation(repo)).kind).toBe('rebase');
    writeFileSync(join(repo, 'a.txt'), 'resolved\n');
    git(repo, ['add', 'a.txt']);

    const status = await continueOperation(repo);
    expect(status.entries).toEqual([]);
    expect(await getOperation(repo)).toEqual({ kind: 'none' });
    expect(gitOut(repo, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['main', 'side', 'base']);
    expect(gitOut(repo, ['show', 'HEAD:a.txt'])).toBe('resolved\n');
    cleanupTmpRepo(repo);
  });

  it('cherry-pick 冲突解决后 continue → 完成（生成被摘提交）', async () => {
    const repo = fresh(pickConflictTemplate);
    try {
      git(repo, ['cherry-pick', pickOne]);
    } catch {
      // cherry-pick 冲突以非零退出码结束，忽略
    }
    expect((await getOperation(repo)).kind).toBe('cherry-pick');

    writeFileSync(join(repo, 'a.txt'), 'resolved\n');
    git(repo, ['add', 'a.txt']);
    const status = await continueOperation(repo);
    expect(status.entries).toEqual([]);
    expect(gitOut(repo, ['log', '--format=%s', '-1']).trim()).toBe('one');
    expect(gitOut(repo, ['show', 'HEAD:a.txt'])).toBe('resolved\n');
    cleanupTmpRepo(repo);
  });

  it('revert 冲突解决后 continue → 完成（生成 Revert 提交）', async () => {
    const repo = fresh(pickConflictTemplate);
    try {
      git(repo, ['revert', pickOne]);
    } catch {
      // revert 冲突以非零退出码结束，忽略
    }
    expect((await getOperation(repo)).kind).toBe('revert');

    // 还原意图是 a.txt 回 base；以 base 内容解决
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(repo, ['add', 'a.txt']);
    const status = await continueOperation(repo);
    expect(status.entries).toEqual([]);
    expect(gitOut(repo, ['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(gitOut(repo, ['show', 'HEAD:a.txt'])).toBe('base\n');
    cleanupTmpRepo(repo);
  });
});

describe('skipOperation', () => {
  it('无进行中操作 → INVALID_QUERY（无态可跳）', async () => {
    const repo = fresh(emptyTemplate);
    await expect(skipOperation(repo)).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    cleanupTmpRepo(repo);
  });

  it('rebase 冲突 → 跳过：冲突提交丢弃、操作态回 none、返回刷新状态', async () => {
    const repo = fresh(rebaseConflictTemplate);
    expect((await getOperation(repo)).kind).toBe('rebase');

    const status = await skipOperation(repo);
    expect(status.headHash).toMatch(/^[0-9a-f]{40}$/);
    expect(gitOut(repo, ['log', '--format=%s', '-2']).trim().split('\n')).toEqual(['side', 'base']);
    cleanupTmpRepo(repo);
  });

  it('merge 冲突 → INVALID_QUERY（merge 无 skip 概念）', async () => {
    const repo = fresh(mergeConflictTemplate);
    await expect(skipOperation(repo)).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    cleanupTmpRepo(repo);
  });
});
