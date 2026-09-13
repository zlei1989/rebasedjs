import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneGitRepo, findRepoRoot, initGitRepo, readHeadBranch } from './repo';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

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
    const plain = createTmpDir('rebased-plain-');
    dirs.push(plain);
    expect(await findRepoRoot(plain)).toBeNull();
  });

  it('initGitRepo 初始化新仓库', async () => {
    const target = createTmpDir('rebased-init-');
    dirs.push(target);
    await initGitRepo(target);
    expect(existsSync(join(target, '.git'))).toBe(true);
    expect(await findRepoRoot(target)).toBe(target);
  });

  // 本机 git 慢（杀软扫描）+ clone 的 msys2 传输 helper 并发初始化偶发挂起——90s 超时 + 失败重试
  it('cloneGitRepo 克隆仓库', { timeout: 90000, retry: 2 }, async () => {
    const src = createTmpRepo();
    dirs.push(src);
    const target = createTmpDir('rebased-clone-');
    dirs.push(target);
    await cloneGitRepo(src, target);
    expect(await findRepoRoot(target)).toBe(target);
  });

  // readHeadBranch：对齐 GitRecentProjectsBranchesService.getBranch——
  // `ref: <target>` 剥已知前缀后返回分支名；HEAD 为提交哈希（detached）→ null。
  // 夹具直接写 .git/HEAD 文本（0 git spawn）：被测的是「HEAD 文本 → 分支名」这条解析链。
  describe('readHeadBranch', () => {
    it('真实 git 仓库（unborn HEAD）返回默认分支名', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      // 期望值从仓库自己的 HEAD 文件取，避免依赖本机 init.defaultBranch
      const head = readFileSync(join(repo, '.git', 'HEAD'), 'utf8').trim();
      expect(head.startsWith('ref: refs/heads/')).toBe(true);
      expect(await readHeadBranch(repo)).toBe(head.replace('ref: refs/heads/', ''));
    });

    it('HEAD 指向普通本地分支 → 返回分支名', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature-x\n');
      expect(await readHeadBranch(repo)).toBe('feature-x');
    });

    it('HEAD 指向远程跟踪引用 → 剥 refs/remotes/ 前缀', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/remotes/origin/main\n');
      expect(await readHeadBranch(repo)).toBe('origin/main');
    });

    it('HEAD 为 40 位提交哈希（detached）→ null', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      writeFileSync(join(repo, '.git', 'HEAD'), `${'a'.repeat(40)}\n`);
      expect(await readHeadBranch(repo)).toBeNull();
    });

    it('.git 为文件（worktree/linked）→ 解析 gitdir 后读其 HEAD', async () => {
      const repo = createTmpDir('rebased-head-wt-');
      const gitDir = createTmpDir('rebased-head-wt-git-');
      dirs.push(repo, gitDir);
      writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/wt-branch\n');
      writeFileSync(join(repo, '.git'), `gitdir: ${gitDir}\n`);
      expect(await readHeadBranch(repo)).toBe('wt-branch');
    });

    it('非仓库目录 / 无 HEAD 文件 → null', async () => {
      const plain = createTmpDir('rebased-head-plain-');
      const bare = createTmpDir('rebased-head-nogit-');
      dirs.push(plain, bare);
      expect(await readHeadBranch(plain)).toBeNull();
      mkdirSync(join(bare, '.git'), { recursive: true });
      expect(await readHeadBranch(bare)).toBeNull();
    });
  });
});
