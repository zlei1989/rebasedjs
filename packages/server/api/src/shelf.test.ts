import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyShelfAction, getShelves, importPatchIntoShelf } from './shelf';
import { getConfigDir } from './lib/config-store';
import { createPatch, getPatches } from './patch';
import { openRepo } from './repo';
import { getRepoStatus } from './status';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

let configDir: string;
const dirs: string[] = [];

beforeAll(() => {
  // 配置目录隔离：每个测试文件独立 REBASED_CONFIG_DIR，避免污染用户配置
  configDir = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

afterAll(() => {
  dirs.forEach(cleanupTmpRepo);
  rmSync(configDir, { recursive: true, force: true });
});

/** 造带初始提交的仓库（shelf 按 repoId 键控，需先 openRepo 注册） */
async function repoWithCommit(file: string, content: string): Promise<string> {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  await openRepo(repo);
  return repo;
}

/** 该仓库的 shelf 目录：<configDir>/shelves/<repoId>/ */
async function shelvesDir(repo: string): Promise<string> {
  const { id } = await openRepo(repo);
  return join(getConfigDir(), 'shelves', id);
}

describe('shelf 功能', () => {
  it('初始空列表；未注册 repoPath 抛 REPO_NOT_FOUND', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    expect((await getShelves(repo)).shelves).toEqual([]);
    const unregistered = createTmpRepo();
    dirs.push(unregistered);
    await expect(getShelves(unregistered)).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });

  it('save：patch.diff 存 git diff HEAD 全文，未跟踪文件递归复制到 untracked/（保留相对路径），保存不清理工作区', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    writeFileSync(join(repo, 'new.txt'), 'new');
    mkdirSync(join(repo, 'dir'), { recursive: true });
    writeFileSync(join(repo, 'dir', 'sub.txt'), 'sub');

    const list = await applyShelfAction(repo, { action: 'save', name: 'wip' });
    expect(list.shelves).toHaveLength(1);
    expect(list.shelves[0]).toMatchObject({ name: 'wip', untrackedCount: 2 });
    expect(list.shelves[0]!.createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const dir = join(await shelvesDir(repo), 'wip');
    const diff = readFileSync(join(dir, 'patch.diff'), 'utf8');
    expect(diff).toContain('diff --git a/a.txt b/a.txt');
    expect(diff).toContain('+v2');
    expect(readFileSync(join(dir, 'untracked', 'new.txt'), 'utf8')).toBe('new');
    expect(readFileSync(join(dir, 'untracked', 'dir', 'sub.txt'), 'utf8')).toBe('sub');
    // 保存不清理工作区
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
    expect(readFileSync(join(repo, 'new.txt'), 'utf8')).toBe('new');
  });

  it('save：diff HEAD = 工作区+暂存全量', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'v3');

    await applyShelfAction(repo, { action: 'save', name: 'all' });
    const diff = readFileSync(join(await shelvesDir(repo), 'all', 'patch.diff'), 'utf8');
    expect(diff).toContain('+v3');
    expect(diff).not.toContain('+v2');
  });

  it('save 重名 → INVALID_QUERY', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await applyShelfAction(repo, { action: 'save', name: 'dup' });
    await expect(applyShelfAction(repo, { action: 'save', name: 'dup' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '搁置已存在：dup',
    });
  });

  it('restore：tracked 补丁应用回工作区、未跟踪文件回拷，shelf 保留', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    writeFileSync(join(repo, 'new.txt'), 'new');
    await applyShelfAction(repo, { action: 'save', name: 'wip' });
    execFileSync('git', ['-C', repo, 'checkout', '--', 'a.txt']);
    rmSync(join(repo, 'new.txt'));
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1');

    const list = await applyShelfAction(repo, { action: 'restore', name: 'wip' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
    expect(readFileSync(join(repo, 'new.txt'), 'utf8')).toBe('new');
    expect(list.shelves).toHaveLength(1);
  });

  it('restore：目标存在且与存档不同 → 跳过不覆盖（保留用户版本）', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    writeFileSync(join(repo, 'new.txt'), 'shelf');
    await applyShelfAction(repo, { action: 'save', name: 'wip' });
    execFileSync('git', ['-C', repo, 'checkout', '--', 'a.txt']);
    writeFileSync(join(repo, 'new.txt'), 'user');

    await applyShelfAction(repo, { action: 'restore', name: 'wip' });
    expect(readFileSync(join(repo, 'new.txt'), 'utf8')).toBe('user');
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
  });

  it('restore 坏补丁：与 patch apply 相同的 INVALID_QUERY 映射，失败零变更（不落半程、不回拷）', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    writeFileSync(join(repo, 'new.txt'), 'new');
    await applyShelfAction(repo, { action: 'save', name: 'wip' });
    execFileSync('git', ['-C', repo, 'checkout', '--', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'v3');
    rmSync(join(repo, 'new.txt')); // 若失败后仍回拷未跟踪文件，此处会被恢复——锁定"失败不落半程"
    const before = await getRepoStatus(repo);

    let err: unknown;
    try {
      await applyShelfAction(repo, { action: 'restore', name: 'wip' });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'INVALID_QUERY' });
    expect((err as Error).message).toMatch(/^补丁无法应用：error: patch failed: a\.txt:\d+$/);
    // 失败零变更：tracked 文件、status 与未跟踪文件均保持原样
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v3');
    expect(await getRepoStatus(repo)).toEqual(before);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
  });

  it('restore 纯未跟踪 shelf：patch.diff 为空 → 跳过 apply、仅回拷未跟踪文件', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'new.txt'), 'new');
    await applyShelfAction(repo, { action: 'save', name: 'untracked-only' });
    // 无 tracked 变更 → patch.diff 0 字节（git apply 空输入会 exit 128，须跳过 apply）
    expect(readFileSync(join(await shelvesDir(repo), 'untracked-only', 'patch.diff'), 'utf8')).toBe('');
    rmSync(join(repo, 'new.txt'));

    const list = await applyShelfAction(repo, { action: 'restore', name: 'untracked-only' });
    expect(readFileSync(join(repo, 'new.txt'), 'utf8')).toBe('new');
    expect(list.shelves).toHaveLength(1);
  });

  it('drop：删除 shelf 目录并刷新列表；restore/drop 不存在 → INVALID_REF', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await applyShelfAction(repo, { action: 'save', name: 'wip' });
    expect(existsSync(join(await shelvesDir(repo), 'wip'))).toBe(true);

    const list = await applyShelfAction(repo, { action: 'drop', name: 'wip' });
    expect(list.shelves).toEqual([]);
    expect(existsSync(join(await shelvesDir(repo), 'wip'))).toBe(false);

    await expect(applyShelfAction(repo, { action: 'drop', name: 'ghost' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '搁置不存在：ghost',
    });
    await expect(applyShelfAction(repo, { action: 'restore', name: 'ghost' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '搁置不存在：ghost',
    });
  });
});

describe('importPatchIntoShelf（Import Patches into Shelf）', () => {
  it('导入补丁为同名搁置：patch.diff = 补丁全文（仅 tracked 变更，无 untracked 目录），补丁本身保留', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const patchList = await createPatch(repo, { name: 'import-me' });
    expect(patchList.patches).toHaveLength(1);

    const list = await importPatchIntoShelf(repo, 'import-me');
    expect(list.shelves).toHaveLength(1);
    expect(list.shelves[0]).toMatchObject({ name: 'import-me', untrackedCount: 0 });

    const dir = join(await shelvesDir(repo), 'import-me');
    expect(readFileSync(join(dir, 'patch.diff'), 'utf8')).toContain('+v2');
    expect(existsSync(join(dir, 'untracked'))).toBe(false);
    // 补丁存档不受影响
    expect((await getPatches(repo)).patches).toHaveLength(1);
  });

  it('导入后 restore：补丁的 git diff HEAD 形状可直接应用回工作区', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await createPatch(repo, { name: 'p' });
    await importPatchIntoShelf(repo, 'p');
    execFileSync('git', ['-C', repo, 'checkout', '--', 'a.txt']);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1');

    await applyShelfAction(repo, { action: 'restore', name: 'p' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
  });

  it('补丁不存在 → INVALID_REF；同名词搁置已存在 → INVALID_QUERY', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await expect(importPatchIntoShelf(repo, 'ghost')).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '补丁不存在：ghost',
    });

    await createPatch(repo, { name: 'dup' });
    await importPatchIntoShelf(repo, 'dup');
    await expect(importPatchIntoShelf(repo, 'dup')).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '搁置已存在：dup',
    });
  });
});
