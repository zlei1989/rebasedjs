import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRepo, getAppHomeDir, getRepoById, initRepo, listRecentRepos, openRepo, RECENT_LIMIT, removeRepo } from './repo';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

let configDir: string;
const dirs: string[] = [];

beforeAll(() => {
  // 配置目录隔离：每个测试文件独立 REBASED_CONFIG_DIR，避免污染用户配置
  configDir = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

describe('repo 功能', () => {
  it('openRepo 注册仓库并返回 RepoInfo，非仓库抛 NOT_A_GIT_REPO', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const info = await openRepo(repo);
    expect(info.path).toBe(repo);
    expect(info.name).toBe(repo.split(/[\\/]/).pop());
    expect((await listRecentRepos()).some((r) => r.id === info.id)).toBe(true);
    await expect(openRepo(join(repo, '..'))).rejects.toMatchObject({ code: 'NOT_A_GIT_REPO' });
  });

  it('getRepoById 未注册抛 REPO_NOT_FOUND', () => {
    expect(() => getRepoById('no-such-id')).toThrowError(expect.objectContaining({ code: 'REPO_NOT_FOUND' }));
  });

  // 本机 git 慢（杀软扫描）+ clone 的 msys2 传输 helper 并发初始化偶发挂起——90s 超时 + 失败重试
  it('initRepo 与 cloneRepo 落库注册', { timeout: 90000, retry: 2 }, async () => {
    const t1 = createTmpDir('rebased-api-init-');
    dirs.push(t1);
    const i1 = await initRepo(t1);
    expect(getRepoById(i1.id).path).toBe(t1);

    const src = createTmpRepo();
    dirs.push(src);
    const t2 = createTmpDir('rebased-api-clone-');
    dirs.push(t2);
    const i2 = await cloneRepo(src, t2);
    expect(getRepoById(i2.id).path).toBe(t2);
  });

  it('重复 openRepo 同一路径复用同一仓库', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const a = await openRepo(repo);
    const b = await openRepo(repo);
    expect(b.id).toBe(a.id);
  });

  it('removeRepo 从最近列表移除并清 recentRepoIds，重复移除幂等', async () => {
    const repoA = createTmpRepo();
    const repoB = createTmpRepo();
    dirs.push(repoA, repoB);
    const a = await openRepo(repoA);
    const b = await openRepo(repoB);

    removeRepo(a.id);

    const ids = (await listRecentRepos()).map((r) => r.id);
    expect(ids).not.toContain(a.id);
    expect(ids).toContain(b.id);
    expect(getRepoById(b.id).path).toBe(repoB); // 其余仓库不受影响
    // 幂等：重复移除不抛错
    removeRepo(a.id);
  });

  it('最近列表上限对齐 RECENT_LIMIT（配置直写 60 条 → 返回 50 条）', async () => {
    const repos = Array.from({ length: 60 }, (_, i) => ({
      id: `bulk-${i}`,
      path: `D:\\fake\\repo-${i}`,
      name: `repo-${i}`,
      openedAt: `2026-09-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ repos, settings: { logInEditor: true, recentRepoIds: repos.map((r) => r.id) } }),
    );
    expect(RECENT_LIMIT).toBe(50);
    expect(await listRecentRepos()).toHaveLength(50);
  });

  // listRecentRepos 的派生字段（契约 RecentRepoInfo）：branch 取自 HEAD 文本、valid 取自路径存在性。
  // 两例都不 spawn git：真实仓库走 createTmpRepo 的模板目录，失效仓库直接手写 config.json。
  it('listRecentRepos 派生 branch/valid：路径存在 → valid:true 且 branch 取自 HEAD', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const info = await openRepo(repo);
    const head = readFileSync(join(repo, '.git', 'HEAD'), 'utf8').trim();

    const listed = (await listRecentRepos()).find((r) => r.id === info.id);

    expect(listed).toMatchObject({ id: info.id, valid: true });
    expect(listed?.branch).toBe(head.replace('ref: refs/heads/', ''));
  });

  it('listRecentRepos 派生 branch/valid：路径不存在 → valid:false 且 branch:null', async () => {
    const missing = join(configDir, 'no-such-repo');
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        repos: [{ id: 'gone', path: missing, name: 'gone', openedAt: '2026-09-01T00:00:00.000Z' }],
        settings: { logInEditor: true, recentRepoIds: ['gone'] },
      }),
    );

    const listed = await listRecentRepos();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'gone', branch: null, valid: false });
  });

  it('getAppHomeDir 返回宿主用户主目录', () => {
    expect(getAppHomeDir()).toBe(homedir());
  });
});

// 头像色号：逐字对齐 Java ProjectWindowCustomizerService——
// getOrGenerateAssociatedColorIndex:327-343（有则复用、无则取新号并保存）
// + nextColorIndex:452-457（(上次值 ?? 随机) + 1) % 9，9 = ProjectIconPalette.gradients.size）。
describe('listRecentRepos 头像色号', () => {
  /**
   * 写一份单仓库配置并返回配置文件路径。
   * avatarColors 刻意放在 JSON **最前**：loadConfig 会把键序重排成 repos→settings→avatarColors，
   * 故「文件字节未变」即可断定没有发生写盘（见「复用原色号且不写盘」用例）。
   */
  function writeAvatarConfig(
    repoPath: string,
    avatarColors?: { index: Record<string, number>; lastIndex?: number },
  ): string {
    const file = join(configDir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({
        ...(avatarColors === undefined ? {} : { avatarColors }),
        repos: [{ id: 'avatar-1', path: repoPath, name: 'avatar-1', openedAt: '2026-09-01T00:00:00.000Z' }],
        settings: { logInEditor: true, recentRepoIds: ['avatar-1'] },
      }),
    );
    return file;
  }

  it('未记录过的路径取 (lastIndex + 1) % 9，并写回 index[path] 与 lastIndex', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const file = writeAvatarConfig(repo, { index: {}, lastIndex: 3 });

    const [listed] = await listRecentRepos();

    expect(listed.colorIndex).toBe(4);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      avatarColors: { index: Record<string, number>; lastIndex?: number };
    };
    expect(saved.avatarColors.index[repo]).toBe(4);
    expect(saved.avatarColors.lastIndex).toBe(4);
  });

  it('lastIndex = 8 时回绕到 0（对齐 Java nextColorIndex 的 % colorsCount）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeAvatarConfig(repo, { index: {}, lastIndex: 8 });

    const [listed] = await listRecentRepos();

    expect(listed.colorIndex).toBe(0);
  });

  it('已记录的路径复用原色号且不写盘（对齐 Java getAssociatedColorIndex）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const file = writeAvatarConfig(repo, { index: { [repo]: 6 }, lastIndex: 2 });
    const before = readFileSync(file, 'utf8');

    const [listed] = await listRecentRepos();

    expect(listed.colorIndex).toBe(6);
    // 字节级相等即「没有写盘」：见 writeAvatarConfig 的键序说明
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('已存色号越界（99）→ 重新分配（对齐 Java getAssociatedColorIndex 的 [0,9) 校验）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeAvatarConfig(repo, { index: { [repo]: 99 }, lastIndex: 5 });

    const [listed] = await listRecentRepos();

    expect(listed.colorIndex).toBe(6); // (5 + 1) % 9
  });

  it('无 lastIndex 时随机起号，结果仍落在 [0,9)', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeAvatarConfig(repo); // 不带 avatarColors：走 Java Random().nextInt(colorsCount) 默认分支

    const [listed] = await listRecentRepos();

    expect(Number.isInteger(listed.colorIndex)).toBe(true);
    expect(listed.colorIndex).toBeGreaterThanOrEqual(0);
    expect(listed.colorIndex).toBeLessThan(9);
  });
});
