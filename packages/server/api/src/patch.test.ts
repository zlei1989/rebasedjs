import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatchService, createPatch, deletePatch, getPatches } from './patch';
import { getConfigDir } from './lib/config-store';
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

/** 造带初始提交的仓库（归档按 repoId 键控，需先 openRepo 注册） */
async function repoWithCommit(file: string, content: string): Promise<string> {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  await openRepo(repo);
  return repo;
}

/** 该仓库的补丁存档目录：<configDir>/patches/<repoId>/ */
async function patchesDir(repo: string): Promise<string> {
  const { id } = await openRepo(repo);
  return join(getConfigDir(), 'patches', id);
}

describe('patch 功能', () => {
  it('初始空列表；未注册 repoPath 抛 REPO_NOT_FOUND', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await openRepo(repo);
    expect((await getPatches(repo)).patches).toEqual([]);
    const unregistered = createTmpRepo();
    dirs.push(unregistered);
    await expect(getPatches(unregistered)).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
    await expect(createPatch(unregistered, { name: 'x' })).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });

  it('创建：缺省 = git diff HEAD（工作区全量，含暂存）；列表含名称/大小/时间', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    const list = await createPatch(repo, { name: 'r1' });
    expect(list.patches).toHaveLength(1);
    expect(list.patches[0]).toMatchObject({ name: 'r1', size: expect.any(Number) });
    expect(list.patches[0]!.createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const diff = readFileSync(join(await patchesDir(repo), 'r1.patch'), 'utf8');
    expect(diff).toContain('diff --git a/a.txt b/a.txt');
    expect(diff).toContain('+v2');
  });

  it('staged=true → 只含暂存 diff（HEAD→index）；缺省再取则只含工作区', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'v3');

    await createPatch(repo, { name: 'st', staged: true });
    const st = readFileSync(join(await patchesDir(repo), 'st.patch'), 'utf8');
    expect(st).toContain('+v2');
    expect(st).not.toContain('+v3');

    await createPatch(repo, { name: 'wf' });
    const wf = readFileSync(join(await patchesDir(repo), 'wf.patch'), 'utf8');
    expect(wf).toContain('+v3'); // 工作区 v3（暂存 v2 已被工作区覆盖）
    expect(wf).not.toContain('+v2');
  });

  it('from/to：两侧给定时为两提交间全 diff；单侧给出时缺侧默认 HEAD', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'c1']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'c2']);
    await openRepo(repo);

    await createPatch(repo, { name: 'both', from: 'HEAD~1', to: 'HEAD' });
    await createPatch(repo, { name: 'onlyTo', to: 'HEAD~1' });
    await createPatch(repo, { name: 'onlyFrom', from: 'HEAD~1' });
    const dir = await patchesDir(repo);
    expect(readFileSync(join(dir, 'both.patch'), 'utf8')).toContain('+v2');
    expect(readFileSync(join(dir, 'onlyTo.patch'), 'utf8')).toContain('-v2'); // diff HEAD HEAD~1
    expect(readFileSync(join(dir, 'onlyFrom.patch'), 'utf8')).toContain('+v2'); // diff HEAD~1 HEAD
  });

  it('创建：多文件变更 = 仓库级 diff 全文（两个文件都出现在补丁文本中）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'a1');
    writeFileSync(join(repo, 'b.txt'), 'b1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await openRepo(repo);
    writeFileSync(join(repo, 'a.txt'), 'a2');
    writeFileSync(join(repo, 'b.txt'), 'b2');

    await createPatch(repo, { name: 'multi' });
    const diff = readFileSync(join(await patchesDir(repo), 'multi.patch'), 'utf8');
    expect(diff).toContain('diff --git a/a.txt b/a.txt');
    expect(diff).toContain('diff --git a/b.txt b/b.txt');
    expect(diff).toContain('+a2');
    expect(diff).toContain('+b2');
  });

  it('paths：只含选中文件 diff（Create Patch from changes 语义）；staged=true 取暂存区', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'a1');
    writeFileSync(join(repo, 'b.txt'), 'b1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await openRepo(repo);
    writeFileSync(join(repo, 'a.txt'), 'a2');
    writeFileSync(join(repo, 'b.txt'), 'b2');

    await createPatch(repo, { name: 'only-a', paths: ['a.txt'] });
    const diff = readFileSync(join(await patchesDir(repo), 'only-a.patch'), 'utf8');
    expect(diff).toContain('diff --git a/a.txt b/a.txt');
    expect(diff).not.toContain('b.txt');

    // staged=true + paths：先暂存 a 再改 a（工作区 v3）→ 补丁含 v2（暂存区），不含 v3
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'a3');
    await createPatch(repo, { name: 'staged-a', paths: ['a.txt'], staged: true });
    const stagedDiff = readFileSync(join(await patchesDir(repo), 'staged-a.patch'), 'utf8');
    expect(stagedDiff).toContain('+a2');
    expect(stagedDiff).not.toContain('a3');
  });

  it('apply 成功：文件回工作区，返回刷新状态', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await createPatch(repo, { name: 'p' });
    execFileSync('git', ['-C', repo, 'checkout', '--', 'a.txt']);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1');

    const status = await applyPatchService(repo, { name: 'p' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
    // porcelain v2 代码：index 干净、工作区修改 → '.M'
    expect(status.entries.find((e) => e.path === 'a.txt')?.code).toBe('.M');
  });

  it('apply 坏补丁：INVALID_QUERY 映射 stderr 首行，失败零变更（check 先行不落半程）', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await createPatch(repo, { name: 'p' });
    writeFileSync(join(repo, 'a.txt'), 'v3'); // 上下文不符
    const before = await getRepoStatus(repo);

    let err: unknown;
    try {
      await applyPatchService(repo, { name: 'p' });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'INVALID_QUERY' });
    expect((err as Error).message).toMatch(/^补丁无法应用：error: patch failed: a\.txt:\d+$/);
    // 失败零变更：文件内容与 status 均保持原样
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v3');
    expect(await getRepoStatus(repo)).toEqual(before);
  });

  it('删除：文件移除、列表刷新；不存在/路径逃逸 → INVALID_REF', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    await createPatch(repo, { name: 'p' });
    const dir = await patchesDir(repo);
    expect(readFileSync(join(dir, 'p.patch'), 'utf8')).toBeDefined();

    const list = await deletePatch(repo, { name: 'p' });
    expect(list.patches).toEqual([]);
    await expect(applyPatchService(repo, { name: 'ghost' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '补丁不存在：ghost',
    });
    await expect(deletePatch(repo, { name: 'ghost' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '补丁不存在：ghost',
    });
    // name 未限制正则 → 服务层防御路径逃逸（按不存在处理）
    await expect(applyPatchService(repo, { name: '../x' })).rejects.toMatchObject({ code: 'INVALID_REF' });
  });

  it('空 diff（无变更）照常创建 0 字节补丁文件', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    const list = await createPatch(repo, { name: 'empty' });
    const file = join(await patchesDir(repo), 'empty.patch');
    expect(readFileSync(file, 'utf8')).toBe('');
    expect(list.patches[0]).toMatchObject({ name: 'empty', size: 0 });
  });

  it('apply 空补丁：跳过 check/apply 直接 no-op 成功并返回正常状态（与 shelf restore 语义对齐）', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    await createPatch(repo, { name: 'empty' }); // 0 字节 diff（工作区无变更）
    const before = await getRepoStatus(repo);

    const status = await applyPatchService(repo, { name: 'empty' });
    expect(status).toEqual(before);
    expect(status.entries).toEqual([]);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1');
  });

  it('同名覆盖：以新 diff 内容更新补丁文件', async () => {
    const repo = await repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await createPatch(repo, { name: 'p' });
    execFileSync('git', ['-C', repo, 'checkout', '--', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'v3');
    await createPatch(repo, { name: 'p' });
    expect(readFileSync(join(await patchesDir(repo), 'p.patch'), 'utf8')).toContain('+v3');
  });
});
