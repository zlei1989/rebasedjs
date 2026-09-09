/** merge 功能测试：三态合并结果、冲突列表附带、进行中操作预检、继续合并。
 *  性能：4 种夹具形状（base/快进/冲突/远程跟踪）在 beforeAll 各建一次模板，用例经 instantiateFixture 复制（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitExitError } from '@rebased/core';
import { resolveConflict } from './conflict';
import { continueMergeOperation, mergeBranchIntoCurrent } from './merge';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

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

/** 快进场景：base 后 side 分支新增 b.txt，回到主分支 */
function makeFfScenario(repo: string): void {
  const main = makeBaseCommit(repo);
  git(repo, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(repo, 'b.txt'), 'side\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'side']);
  git(repo, ['checkout', '-q', main]);
}

/** 冲突场景：base 后两侧改 a.txt 同一行（recipe 同 core merge.test.ts） */
function makeConflictScenario(repo: string): void {
  const main = makeBaseCommit(repo);
  git(repo, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'side']);
  git(repo, ['checkout', '-q', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'main']);
}

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';
let ffTemplate = '';
let conflictTemplate = '';
let remoteSideTemplate = '';

beforeAll(() => {
  baseTemplate = createTmpRepo();
  makeBaseCommit(baseTemplate);
  ffTemplate = createTmpRepo();
  makeFfScenario(ffTemplate);
  conflictTemplate = createTmpRepo();
  makeConflictScenario(conflictTemplate);
  // 远程分支装置：side 提交推成远程分支，本地 fetch 更新 origin/side 跟踪引用
  remoteSideTemplate = createTmpRepo();
  const main = makeBaseCommit(remoteSideTemplate);
  const bare = createTmpDir('rebased-api-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(remoteSideTemplate, ['remote', 'add', 'origin', bare]);
  git(remoteSideTemplate, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(remoteSideTemplate, 'b.txt'), 'side\n');
  git(remoteSideTemplate, ['add', '.']);
  git(remoteSideTemplate, ['commit', '-q', '-m', 'side']);
  git(remoteSideTemplate, ['push', '-q', '-u', 'origin', 'side']);
  // 回主分支拉取远程引用
  git(remoteSideTemplate, ['checkout', '-q', main]);
  git(remoteSideTemplate, ['fetch', '-q', 'origin']);
  templateDirs.push(baseTemplate, ffTemplate, conflictTemplate, remoteSideTemplate, bare);
});

describe('merge 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('快进合并 → success 且 conflicts 为空', async () => {
    const repo = instantiate(ffTemplate);

    const outcome = await mergeBranchIntoCurrent(repo, { branch: 'side' });
    expect(outcome.status).toBe('success');
    expect(outcome.conflicts).toEqual([]);
  });

  it('重复合并 → up-to-date 且 conflicts 为空', async () => {
    const repo = instantiate(ffTemplate);
    await mergeBranchIntoCurrent(repo, { branch: 'side' });

    const outcome = await mergeBranchIntoCurrent(repo, { branch: 'side' });
    expect(outcome.status).toBe('up-to-date');
    expect(outcome.conflicts).toEqual([]);
  });

  it('远程分支直接合并：fetch 后合并 origin/<branch>（远程跟踪引用）→ success', async () => {
    const repo = instantiate(remoteSideTemplate);

    const outcome = await mergeBranchIntoCurrent(repo, { branch: 'origin/side' });
    expect(outcome.status).toBe('success');
    expect(outcome.conflicts).toEqual([]);
  });

  it('冲突合并 → conflicts 且附带冲突列表', async () => {
    const repo = instantiate(conflictTemplate);

    const outcome = await mergeBranchIntoCurrent(repo, { branch: 'side' });
    expect(outcome.status).toBe('conflicts');
    expect(outcome.conflicts).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);
  });

  it('分支不存在 → GitExitError 透出（框架层折为 GIT_ERROR）', async () => {
    const repo = instantiate(baseTemplate);

    await expect(mergeBranchIntoCurrent(repo, { branch: 'ghost' })).rejects.toBeInstanceOf(GitExitError);
  });

  it('已有进行中操作时再次发起合并 → OPERATION_IN_PROGRESS', async () => {
    const repo = instantiate(conflictTemplate);
    await mergeBranchIntoCurrent(repo, { branch: 'side' }); // 进入 merge 操作态

    await expect(mergeBranchIntoCurrent(repo, { branch: 'side' })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
  });

  it('continueMergeOperation 无进行中合并 → INVALID_QUERY', async () => {
    const repo = instantiate(baseTemplate);

    await expect(continueMergeOperation(repo)).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '当前没有进行中的合并',
    });
  });

  it('解决全部冲突后 continueMergeOperation 产合并提交并返回刷新状态', async () => {
    const repo = instantiate(conflictTemplate);
    await mergeBranchIntoCurrent(repo, { branch: 'side' });

    // 手工解决：写最终内容 + add 标记已解决
    writeFileSync(join(repo, 'a.txt'), 'resolved\n');
    git(repo, ['add', 'a.txt']);
    const status = await continueMergeOperation(repo);

    // 返回刷新状态：工作区干净、headHash 指向新合并提交
    expect(status.entries).toEqual([]);
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(status.headHash);
    const parents = git(repo, ['log', '--format=%P', '-1']).trim().split(' ');
    expect(parents).toHaveLength(2);
  });

  it('squash 冲突全链：conflicts（非抛错）→ resolveConflict theirs → continue 产单父提交（信息来自 SQUASH_MSG）', async () => {
    const repo = instantiate(conflictTemplate);

    // squash 从不写 MERGE_HEAD：修复前此处 GitExitError 原样抛，修复后正确分类 conflicts
    const outcome = await mergeBranchIntoCurrent(repo, { branch: 'side', squash: true });
    expect(outcome.status).toBe('conflicts');
    expect(outcome.conflicts).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);

    const list = await resolveConflict(repo, { strategy: 'theirs', path: 'a.txt' });
    expect(list.conflicts).toEqual([]);

    // squash 不在合并态（kind==='none'）但留 SQUASH_MSG：continue 预检须放行
    const status = await continueMergeOperation(repo);
    const parents = git(repo, ['log', '--format=%P', '-1']).trim().split(' ');
    expect(parents).toHaveLength(1); // squash 产普通单父提交（非合并提交）
    expect(git(repo, ['log', '--format=%B', '-1'])).toContain('Squashed commit');
    expect(git(repo, ['show', 'HEAD:a.txt'])).toBe('side\n');
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(status.headHash);
  });
});
