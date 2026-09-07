/**
 * e2e 仓库夹具：临时 git 仓库工厂（对齐 packages/server/api/src/testing/tmp-repo.ts 的写法，
 * 扩展：指定作者/默认分支读取、两条提交种子、裸克隆装置、EPERM 防抖清理）。
 * T3 依赖 makeBareFrom（裸克隆）；cleanup 在 Windows 下对 git 子进程句柄未释放做重试。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** 提交身份（与 core/api 夹具同值，避免依赖开发者全局 git 配置） */
const AUTHOR_NAME = 'Test User';
const AUTHOR_EMAIL = 'test@example.com';

/**
 * 清理重试：EPERM/EBUSY（Windows 句柄未释放——git 子进程退出、Defender 扫描等瞬态锁）
 * 最多重试 6 次、每次间隔 300ms（≈1.5s 窗口；全量套件负载下实测锁窗口可超 600ms，
 * 见 task-1-report）。
 */
const CLEANUP_RETRY_COUNT = 6;
const CLEANUP_RETRY_DELAY_MS = 300;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export interface TmpRepoOptions {
  /** 初始提交主题（默认「初始提交」） */
  initialMessage?: string;
  /** 最近提交主题（默认「e2e 冒烟提交」） */
  headMessage?: string;
  /** 初始分支名（默认 main；git init -b 需要 git >= 2.28） */
  defaultBranch?: string;
}

export interface TmpRepo {
  /** 仓库工作树根目录（openRepo 的入参） */
  repoPath: string;
  /** 默认分支名（git symbolic-ref HEAD --short） */
  defaultBranch: string;
  /** 最近提交主题（测试断言用） */
  headMessage: string;
  /** 初始提交主题（测试断言用） */
  initialMessage: string;
  /** 仓库目录名（LogPage 顶栏展示名 = basename(root)） */
  name: string;
  /** 清理整个仓库目录（EPERM 防抖） */
  cleanup: () => void;
}

/** 建临时工作树仓库：git init（指定分支）+ 局部作者身份 + 两条提交（初始/最近） */
export function createTmpRepo(options: TmpRepoOptions = {}): TmpRepo {
  const initialMessage = options.initialMessage ?? '初始提交';
  const headMessage = options.headMessage ?? 'e2e 冒烟提交';
  const defaultBranch = options.defaultBranch ?? 'main';
  const repoPath = mkdtempSync(join(tmpdir(), 'rebased-e2e-'));

  git(['init', '-q', '-b', defaultBranch], repoPath);
  git(['config', 'user.name', AUTHOR_NAME], repoPath);
  git(['config', 'user.email', AUTHOR_EMAIL], repoPath);
  writeFileSync(join(repoPath, 'README.md'), `# ${basename(repoPath)}\n`);
  git(['add', 'README.md'], repoPath);
  git(['commit', '-q', '-m', initialMessage], repoPath);
  writeFileSync(join(repoPath, 'notes.txt'), 'opened via e2e\n');
  git(['add', 'notes.txt'], repoPath);
  git(['commit', '-q', '-m', headMessage], repoPath);

  return {
    repoPath,
    defaultBranch: git(['symbolic-ref', '--short', 'HEAD'], repoPath),
    headMessage,
    initialMessage,
    name: basename(repoPath),
    cleanup: () => cleanupTmp(repoPath),
  };
}

/** 裸克隆装置（T3 裸仓库场景用）：返回裸仓库目录（clone 不依赖 cwd，目标目录由 mkdtemp 预置为空目录） */
export function makeBareFrom(repoPath: string): string {
  const barePath = mkdtempSync(join(tmpdir(), 'rebased-e2e-bare-'));
  git(['clone', '--bare', '-q', repoPath, barePath], tmpdir());
  return barePath;
}

/**
 * 防抖清理：重试 3 次、间隔 200ms（EPERM/EBUSY 视为 Windows 句柄未释放的可瞬态错误，
 * 其余错误不再重试直接抛出）；force 已保证「目录不存在」不报错。
 */
export function cleanupTmp(target: string): void {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CLEANUP_RETRY_COUNT; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY') break;
      if (attempt < CLEANUP_RETRY_COUNT) {
        // 同步 sleep（测试 worker 为独立子进程，Atomics.wait 可用）
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CLEANUP_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}
