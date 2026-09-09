/** conflict 原语测试：冲突列表/三阶段内容（含双方新增无 base）/整侧采纳 + 标记解决/删除解决。
 *  性能：4 种夹具形状（base/改-改/双方新增/删除-修改冲突）在 beforeAll 各建一次模板，用例经 instantiateFixture 复制（0 spawn）。 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutConflictSide, deleteConflictFile, listConflictedPaths, markResolved, readStageContent } from './conflict';
import { runGit } from './exec';
import { mergeBranch } from './merge';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
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

/** 改-改冲突场景：base → side 改 a.txt 同一行 → 回主分支改同一行，再合并 side 进冲突态 */
async function makeModifyConflict(repo: string): Promise<void> {
  const main = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  await writeFile(join(repo, 'a.txt'), 'side\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'side'], { cwd: repo });
  await runGit(['checkout', main], { cwd: repo });
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'main'], { cwd: repo });
  await mergeBranch(repo, { branch: 'side' });
}

/** 双方新增冲突场景：base 不含 b.txt，两边各自新增 b.txt 不同内容 → 合并后 stage 1 缺失 */
async function makeBothAddedConflict(repo: string): Promise<void> {
  const main = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  await writeFile(join(repo, 'b.txt'), 'side added\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'side add b'], { cwd: repo });
  await runGit(['checkout', main], { cwd: repo });
  await writeFile(join(repo, 'b.txt'), 'main added\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'main add b'], { cwd: repo });
  await mergeBranch(repo, { branch: 'side' });
}

/** 删除/修改冲突场景：side 删 a.txt，主分支改 a.txt → 合并后 stage 3 缺失（[1,2] 对方删除/我方修改） */
async function makeDeleteModifyConflict(repo: string): Promise<void> {
  const main = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  await runGit(['rm', '-q', 'a.txt'], { cwd: repo });
  await runGit(['commit', '-m', 'side delete'], { cwd: repo });
  await runGit(['checkout', main], { cwd: repo });
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await runGit(['add', '.'], { cwd: repo });
  await runGit(['commit', '-m', 'main'], { cwd: repo });
  await mergeBranch(repo, { branch: 'side' });
}

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';
let modifyConflictTemplate = '';
let bothAddedConflictTemplate = '';
let deleteModifyConflictTemplate = '';

beforeAll(async () => {
  baseTemplate = createTmpRepo();
  await makeBaseCommit(baseTemplate);
  modifyConflictTemplate = createTmpRepo();
  await makeModifyConflict(modifyConflictTemplate);
  bothAddedConflictTemplate = createTmpRepo();
  await makeBothAddedConflict(bothAddedConflictTemplate);
  deleteModifyConflictTemplate = createTmpRepo();
  await makeDeleteModifyConflict(deleteModifyConflictTemplate);
  templateDirs.push(baseTemplate, modifyConflictTemplate, bothAddedConflictTemplate, deleteModifyConflictTemplate);
});

describe('conflict 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('无冲突仓库 listConflictedPaths 返回空数组', async () => {
    const repo = instantiate(baseTemplate);

    expect(await listConflictedPaths(repo)).toEqual([]);
  });

  it('改-改冲突态 listConflictedPaths 聚合三阶段', async () => {
    const repo = instantiate(modifyConflictTemplate);

    expect(await listConflictedPaths(repo)).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);
  });

  it('readStageContent 分别返回 base/ours/theirs 内容', async () => {
    const repo = instantiate(modifyConflictTemplate);

    expect(await readStageContent(repo, 'a.txt', 1)).toBe('base\n');
    expect(await readStageContent(repo, 'a.txt', 2)).toBe('main\n');
    expect(await readStageContent(repo, 'a.txt', 3)).toBe('side\n');
  });

  it('双方新增冲突无 base：stage 1 返回 null，stage 2/3 正常', async () => {
    const repo = instantiate(bothAddedConflictTemplate);

    expect(await listConflictedPaths(repo)).toEqual([{ path: 'b.txt', stages: [2, 3] }]);
    expect(await readStageContent(repo, 'b.txt', 1)).toBeNull();
    expect(await readStageContent(repo, 'b.txt', 2)).toBe('main added\n');
    expect(await readStageContent(repo, 'b.txt', 3)).toBe('side added\n');
  });

  it('readStageContent 对不存在路径返回 null', async () => {
    const repo = instantiate(baseTemplate);

    expect(await readStageContent(repo, 'ghost.txt', 2)).toBeNull();
  });

  it('checkoutConflictSide(theirs) + markResolved 后工作区为对方内容且冲突清空', async () => {
    const repo = instantiate(modifyConflictTemplate);

    await checkoutConflictSide(repo, 'a.txt', 'theirs');
    await markResolved(repo, 'a.txt');

    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('side\n');
    expect(await listConflictedPaths(repo)).toEqual([]);
  });

  it('checkoutConflictSide(ours) 后工作区为本方内容', async () => {
    const repo = instantiate(modifyConflictTemplate);

    await checkoutConflictSide(repo, 'a.txt', 'ours');

    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('main\n');
  });

  it('deleteConflictFile 以删除解决删除/修改冲突：工作区文件删除、删除已暂存、冲突清空', async () => {
    const repo = instantiate(deleteModifyConflictTemplate);
    expect(await listConflictedPaths(repo)).toEqual([{ path: 'a.txt', stages: [1, 2] }]);

    await deleteConflictFile(repo, 'a.txt');

    // git rm 同时删工作区文件并暂存删除（无需再 markResolved）
    await expect(access(join(repo, 'a.txt'))).rejects.toThrow();
    expect(await listConflictedPaths(repo)).toEqual([]);
    const { stdout } = await runGit(['status', '--porcelain'], { cwd: repo });
    expect(stdout).toContain('D  a.txt');
  });
});
