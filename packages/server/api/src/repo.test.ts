import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
    expect(listRecentRepos().some((r) => r.id === info.id)).toBe(true);
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

    const ids = listRecentRepos().map((r) => r.id);
    expect(ids).not.toContain(a.id);
    expect(ids).toContain(b.id);
    expect(getRepoById(b.id).path).toBe(repoB); // 其余仓库不受影响
    // 幂等：重复移除不抛错
    removeRepo(a.id);
  });

  it('最近列表上限对齐 RECENT_LIMIT（配置直写 60 条 → 返回 50 条）', () => {
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
    expect(listRecentRepos()).toHaveLength(50);
  });

  it('getAppHomeDir 返回宿主用户主目录', () => {
    expect(getAppHomeDir()).toBe(homedir());
  });
});
