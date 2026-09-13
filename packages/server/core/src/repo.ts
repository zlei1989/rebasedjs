/** 仓库级原语：发现 .git（含 worktree 的 .git 文件）、初始化、克隆、读 HEAD 分支名。 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
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

/** 克隆仓库：超时 30s（git 传输 helper 在 Windows msys2 并发下可能挂起，超时即杀进程拒绝） */
export async function cloneGitRepo(url: string, targetDir: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  await runGit(['clone', url, targetDir], { cwd: dirname(targetDir), signal: opts.signal, timeoutMs: 30000 });
}

/** git ref 已知前缀（GitRefUtil.knownPrefixes）：只剥这三种，其余原样返回 */
const REF_PREFIXES = ['refs/heads/', 'refs/remotes/', 'refs/tags/'] as const;

/** 剥 git ref 前缀（GitRefUtil.stripRefsPrefix） */
function stripRefsPrefix(refName: string): string {
  for (const prefix of REF_PREFIXES) {
    if (refName.startsWith(prefix)) return refName.slice(prefix.length);
  }
  return refName;
}

/** 提交哈希（40 位 SHA-1 / 64 位 SHA-256，十六进制）——detached HEAD 的判据（GitRefUtil.parseHash 语义） */
const COMMIT_HASH_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * 解析 .git/HEAD 文本为分支名（GitRecentProjectsBranchesService.getBranch 的等价）：
 * 内容为提交哈希 → null（detached，Java 的 NotOnBranch）；`ref: <target>` → 剥前缀后的分支名；
 * 其余（空文件、reftable stub 等）→ null（Java 的 Unknown）。
 * 注意：刚 init 尚无提交的 unborn HEAD 同样是 `ref: refs/heads/x`，**必须返回分支名**（对齐 Java）。
 */
function parseHeadContent(content: string): string | null {
  const text = content.trim();
  if (COMMIT_HASH_RE.test(text)) return null;
  const matched = /^ref:\s*(.+)$/.exec(text);
  if (matched === null) return null;
  const target = matched[1].trim();
  return target === '' ? null : stripRefsPrefix(target);
}

/**
 * 解析仓库的 git 目录：`.git` 为目录 → 自身；`.git` 为文件（worktree/linked worktree）→
 * 读其 `gitdir: <path>` 指向的目录（相对路径按仓库根解析）；不存在或读不出 → null。
 */
async function resolveGitDir(repoPath: string): Promise<string | null> {
  const gitPath = join(repoPath, '.git');
  try {
    const info = await stat(gitPath);
    if (info.isDirectory()) return gitPath;
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  let content: string;
  try {
    content = await readFile(gitPath, 'utf8');
  } catch {
    return null;
  }
  const matched = /^gitdir:\s*(.+)$/.exec(content.trim());
  if (matched === null) return null;
  const target = matched[1].trim();
  return isAbsolute(target) ? target : resolve(repoPath, target);
}

/**
 * 读 .git/HEAD 解析当前分支名（对齐 GitRecentProjectsBranchesService.loadBranch/getBranch）。
 * 做什么：给最近仓库列表项提供分支后缀文案。
 * 怎么做：**直读文件、不 spawn git**——最近列表逐仓查询，spawn 成本不可接受（Java 同款做法：
 *        该 provider 也是直读 HEAD 而非跑 `git status`，并用 caffeine 缓存）。
 * 降级：reftable 后端仓库的 HEAD 是 stub（内容非 `ref:` 非哈希）→ 返回 null，即不显示分支后缀
 *      （Java 有 GitReftableReader 兜底，本仓不引入该解析）。
 */
export async function readHeadBranch(repoPath: string): Promise<string | null> {
  const gitDir = await resolveGitDir(repoPath);
  if (gitDir === null) return null;
  let content: string;
  try {
    content = await readFile(join(gitDir, 'HEAD'), 'utf8');
  } catch {
    return null;
  }
  return parseHeadContent(content);
}
