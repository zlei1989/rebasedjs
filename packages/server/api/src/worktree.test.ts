/** worktree 服务集成测试（真实 git）；api 层预检/映射裁定见 task-3-brief。
 *  性能：base 提交夹具在 beforeAll 建一次模板，用例经 instantiateFixture 复制（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorktree, getWorktrees, pruneWorktrees, removeWorktree } from './worktree';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
  dirs.push(repo);
  return repo;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeBaseCommit(repo: string): string {
  const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return defaultBranch;
}

// ---- 夹具模板：beforeAll 建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';

beforeAll(() => {
  baseTemplate = createTmpRepo();
  makeBaseCommit(baseTemplate);
  templateDirs.push(baseTemplate);
});

/** 主仓库旁的副工作树路径（带空格，验证 porcelain 路径不引号） */
function siblingPath(repo: string, suffix: string): string {
  return join(dirname(repo), basename(repo) + suffix);
}

/** 路径等价比较：git 输出 realpath 长形式，mkdtemp 可能返回 8.3 短形式——OS 级归一 */
function samePath(a: string, b: string): boolean {
  return realpathSync.native(a) === realpathSync.native(b);
}

describe('worktree 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getWorktrees 单仓库返回主工作树（branch/head 完整哈希）', async () => {
    const repo = instantiate(baseTemplate);
    const base = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    const headSha = git(repo, ['rev-parse', 'HEAD']);

    const list = await getWorktrees(repo);
    expect(list.worktrees).toHaveLength(1);
    const main = list.worktrees[0];
    // P4-B 终审 I1：主工作树条目 path 改写为 repoPath 原字符串（8.3 短形式+反斜杠保真），字符串全等
    expect(main.path).toBe(repo);
    expect(main.branch).toBe(base);
    expect(main.detached).toBe(false);
    expect(main.head).toBe(headSha);
  });

  it('getWorktrees：repoPath 为 realpath 长形式时主工作树 path 字符串等于入参', async () => {
    const repo = instantiate(baseTemplate);
    const repoReal = realpathSync.native(repo); // 长形式（%TEMP% 为 8.3 短形式，git 输出长形式+正斜杠）

    const list = await getWorktrees(repoReal);

    expect(list.worktrees).toHaveLength(1);
    expect(list.worktrees[0].path).toBe(repoReal);
  });

  it('createWorktree newBranch：返回刷新列表含主+副（branch 名与 head）', async () => {
    const repo = instantiate(baseTemplate);
    const wtPath = siblingPath(repo, '-wt dir');
    dirs.push(wtPath);

    const list = await createWorktree(repo, { path: wtPath, newBranch: 'feat-2' });

    expect(list.worktrees).toHaveLength(2);
    const wt = list.worktrees.find((w) => samePath(w.path, wtPath));
    expect(wt).toBeDefined();
    expect(wt?.branch).toBe('feat-2');
    expect(wt?.detached).toBe(false);
    expect(wt?.head).toBe(git(repo, ['rev-parse', 'refs/heads/feat-2']));
  });

  it('createWorktree branch 挂接既有分支', async () => {
    const repo = instantiate(baseTemplate);
    git(repo, ['branch', 'feat']);
    const wtPath = siblingPath(repo, '-wt attach');
    dirs.push(wtPath);

    const list = await createWorktree(repo, { path: wtPath, branch: 'feat' });

    const wt = list.worktrees.find((w) => samePath(w.path, wtPath));
    expect(wt?.branch).toBe('feat');
  });

  it('createWorktree 预检互斥：branch+newBranch 同给或都缺 → INVALID_QUERY（先于分支存在性）', async () => {
    const repo = instantiate(baseTemplate);
    const wtPath = siblingPath(repo, '-wt excl');

    // 同给：即使分支不存在也先报互斥（裁定预检顺序）
    await expect(createWorktree(repo, { path: wtPath, branch: 'nope', newBranch: 'x' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '需指定分支或新分支（二选一）',
    });
    await expect(createWorktree(repo, { path: wtPath })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '需指定分支或新分支（二选一）',
    });
  });

  it('createWorktree 分支不存在 → INVALID_REF', async () => {
    const repo = instantiate(baseTemplate);

    await expect(
      createWorktree(repo, { path: siblingPath(repo, '-wt nope'), branch: 'nope' }),
    ).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '分支不存在：nope',
    });
  });

  it('createWorktree 路径无效：非绝对 / 在 repo 内 / 逃逸 → INVALID_QUERY', async () => {
    const repo = instantiate(baseTemplate);
    const base = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    const cases = [
      join('relative', 'wt'), // 相对路径
      join(repo, 'inside'), // 在仓库目录内
      join(repo, '..', basename(repo), 'inside'), // .. 归一化后落回仓库目录内（防逃逸）
    ];
    for (const p of cases) {
      await expect(createWorktree(repo, { path: p, branch: base })).rejects.toMatchObject({
        code: 'INVALID_QUERY',
        message: `路径无效：${p}`,
      });
    }
  });

  it('createWorktree 路径无效（realpath 归一判定）：恰等 repoPath / 大小写变体 / 8.3 变体 inside / 副工作树目录内 → INVALID_QUERY 且不残留条目', async () => {
    const repo = instantiate(baseTemplate);
    const base = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    const repoReal = realpathSync.native(repo);
    // 8.3 短名（FSO ShortPath；未启用 8.3 时回落长名）——长父目录 + 短名仓库目录混合构造
    const shortBase = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${repoReal.replace(/'/g, '\'\'')}').ShortPath`],
      { encoding: 'utf8' },
    )
      .trim()
      .split(/[\\/]/)
      .pop() ?? basename(repoReal);
    const caseVariantInside = join(repoReal.toUpperCase(), 'inside-case');
    const shortVariantInside = join(dirname(repoReal), shortBase, 'inside-short');
    // 恰等（T3 M1）与两种归一变体都在 add 前预拒（父目录已存在 → realpath 归一），无残留
    for (const p of [repo, caseVariantInside, shortVariantInside]) {
      await expect(createWorktree(repo, { path: p, branch: base })).rejects.toMatchObject({
        code: 'INVALID_QUERY',
        message: `路径无效：${p}`,
      });
      expect((await getWorktrees(repo)).worktrees).toHaveLength(1);
    }
    // add 成功路径的 post-add 校验：副工作树目录内嵌套（git 不拒但语义非法）→ 回滚 → 无残留
    const wtPath = siblingPath(repo, '-wt nest');
    dirs.push(wtPath);
    const createdSibling = await createWorktree(repo, { path: wtPath, newBranch: 'nest-b' });
    expect(createdSibling.worktrees).toHaveLength(2);
    const nested = join(realpathSync.native(wtPath), 'nested');
    await expect(createWorktree(repo, { path: nested, newBranch: 'nest-inner' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: `路径无效：${nested}`,
    });
    expect((await getWorktrees(repo)).worktrees).toHaveLength(2); // 回滚：仅主+副
  });

  it('removeWorktree path 等于主仓库 → INVALID_QUERY', async () => {
    const repo = instantiate(baseTemplate);

    await expect(removeWorktree(repo, { path: repo })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '不能移除当前工作树',
    });
  });

  it('removeWorktree 不在列表（不存在/逃逸路径）→ 直接 INVALID_QUERY 不调 core', async () => {
    const repo = instantiate(baseTemplate);

    const missing = siblingPath(repo, '-never');
    await expect(removeWorktree(repo, { path: missing })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: `工作树不存在：${missing}`,
    });
    const escaped = join(repo, '..', `${basename(repo)}-escape`);
    await expect(removeWorktree(repo, { path: escaped })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: `工作树不存在：${escaped}`,
    });
  });

  it('removeWorktree force 透传：dirty 无 force → GIT_ERROR，force → 成功且列表复原', async () => {
    const repo = instantiate(baseTemplate);
    const wtPath = siblingPath(repo, '-wt dirty');
    dirs.push(wtPath);
    const created = await createWorktree(repo, { path: wtPath, newBranch: 'dirty-b' });
    const wt = created.worktrees.find((w) => samePath(w.path, wtPath));
    expect(wt).toBeDefined();
    writeFileSync(join(wtPath, 'a.txt'), 'dirty payload');

    await expect(removeWorktree(repo, { path: wt!.path })).rejects.toMatchObject({ code: 'GIT_ERROR' });

    const list = await removeWorktree(repo, { path: wt!.path, force: true });
    expect(list.worktrees).toHaveLength(1);
  });

  it('pruneWorktrees：目录缺失的陈旧条目被清理', async () => {
    const repo = instantiate(baseTemplate);
    const wtPath = siblingPath(repo, '-wt stale');
    await createWorktree(repo, { path: wtPath, newBranch: 'stale-b' });
    rmSync(wtPath, { recursive: true, force: true });
    expect((await getWorktrees(repo)).worktrees).toHaveLength(2); // 未 prune 前仍列出

    const list = await pruneWorktrees(repo);

    expect(list.worktrees).toHaveLength(1);
  });
});
