/** 仓库级原语：发现 .git（含 worktree 的 .git 文件）、初始化、克隆。 */
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { runGit } from './exec';

/** 自 startPath 向上找 .git（目录或 worktree 指针文件），找不到返回 null */
export async function findRepoRoot(startPath: string): Promise<string | null> {
  let cur: string = startPath;
  for (;;) {
    const gitPath = join(cur, '.git');
    if (existsSync(gitPath)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export async function initGitRepo(path: string): Promise<void> {
  await runGit(['init', '-q', path], { cwd: parse(path).root });
}

export async function cloneGitRepo(url: string, targetDir: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  await runGit(['clone', url, targetDir], { cwd: dirname(targetDir), signal: opts.signal });
}
