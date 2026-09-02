import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneGitRepo, findRepoRoot, initGitRepo } from './repo';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('repo 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('findRepoRoot 从子目录向上发现仓库根', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const sub = join(repo, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    expect(await findRepoRoot(sub)).toBe(repo);
  });

  it('findRepoRoot 对非仓库目录返回 null', async () => {
    const plain = join(tmpdir(), `rebased-plain-${Date.now()}`);
    mkdirSync(plain, { recursive: true });
    dirs.push(plain);
    expect(await findRepoRoot(plain)).toBeNull();
  });

  it('initGitRepo 初始化新仓库', async () => {
    const target = join(tmpdir(), `rebased-init-${Date.now()}`);
    dirs.push(target);
    await initGitRepo(target);
    expect(existsSync(join(target, '.git'))).toBe(true);
    expect(await findRepoRoot(target)).toBe(target);
  });

  // 本机 git 慢（杀软扫描）+ clone 的 msys2 传输 helper 并发初始化偶发挂起——90s 超时 + 失败重试
  it('cloneGitRepo 克隆仓库', { timeout: 90000, retry: 2 }, async () => {
    const src = createTmpRepo();
    dirs.push(src);
    const target = join(tmpdir(), `rebased-clone-${Date.now()}`);
    dirs.push(target);
    await cloneGitRepo(src, target);
    expect(await findRepoRoot(target)).toBe(target);
  });
});
