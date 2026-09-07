/**
 * worktree 原语：list（--porcelain 解析，条目空行分隔）/ add / remove / prune。
 * 一切 git 经 runGit。--porcelain 输出实测（Windows git 2.47.0.windows.2）：
 * 路径含空格不引号（`worktree C:/.../main repo`）、MSYS 正斜杠；
 * detached 工作树输出 `detached` 行（无 branch 行）；HEAD 行恒为完整 40 位哈希。
 * 防御式处理引号/C 转义：部分版本对特殊字符路径会引用（core.quotePath）。
 */
import { runGit } from './exec';

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  detached: boolean;
  head: string;
}

const BRANCH_PREFIX = 'branch refs/heads/';

/** C 风格反转义：git 引用路径时 \" \\ \n \t \r 与八进制字节转义（UTF-8 逐字节） */
function cUnquote(s: string): string {
  const out: string[] = [];
  const bytes: number[] = [];
  const flushBytes = (): void => {
    if (bytes.length > 0) {
      out.push(Buffer.from(bytes).toString('utf8'));
      bytes.length = 0;
    }
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      const simple = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' } as Record<string, string>;
      if (simple[next] !== undefined) {
        flushBytes();
        out.push(simple[next]);
        i++;
      } else if (/[0-7]/.test(next)) {
        const m = /^([0-7]{1,3})/.exec(s.slice(i + 1));
        if (m === null) {
          flushBytes();
          out.push(next);
          i++;
        } else {
          bytes.push(parseInt(m[1], 8));
          i += m[1].length;
        }
      } else {
        flushBytes();
        out.push(next);
        i++;
      }
    } else if (ch === '"') {
      flushBytes();
    } else {
      flushBytes();
      out.push(ch);
    }
  }
  flushBytes();
  return out.join('');
}

/** 解析 `git worktree list --porcelain`：条目以空行分隔，worktree/HEAD/branch|detached 行 */
export function parseWorktreePorcelain(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  const flush = (): void => {
    if (current !== null) entries.push(current);
    current = null;
  };
  for (const line of raw.split('\n')) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      let p = line.slice('worktree '.length);
      if (p.startsWith('"') && p.endsWith('"')) p = cUnquote(p.slice(1, -1));
      current = { path: p, branch: null, detached: false, head: '' };
    } else if (current !== null && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (current !== null && line.startsWith(BRANCH_PREFIX)) {
      current.branch = line.slice(BRANCH_PREFIX.length);
    } else if (current !== null && line === 'detached') {
      current.detached = true;
      current.branch = null;
    }
  }
  flush();
  // detached 裁定：head 取 HEAD 前 7 位短哈希（attached 保留完整哈希）
  return entries.map((e) => (e.detached ? { ...e, head: e.head.slice(0, 7) } : e));
}

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const { stdout } = await runGit(['worktree', 'list', '--porcelain'], { cwd });
  return parseWorktreePorcelain(stdout);
}

export async function addWorktree(
  cwd: string,
  path: string,
  opts: { branch?: string; newBranch?: string },
): Promise<void> {
  if (opts.branch === undefined && opts.newBranch === undefined) {
    // 无分支参数会静默创建 detached 工作树（服务层预检之外的保险）
    throw new Error('addWorktree 需要 branch 或 newBranch（服务层应先行校验）');
  }
  const args = ['worktree', 'add'];
  if (opts.newBranch !== undefined) args.push('-b', opts.newBranch);
  // `--` 紧随选项后、path 前：path 以 `-` 开头时不被当作选项（语法 [options] <path> [<commit-ish>]）
  args.push('--');
  args.push(path);
  if (opts.branch !== undefined) args.push(opts.branch);
  await runGit(args, { cwd });
}

export async function removeWorktree(cwd: string, path: string, opts: { force?: boolean } = {}): Promise<void> {
  const args = ['worktree', 'remove'];
  if (opts.force === true) args.push('--force');
  // `--` 紧随选项后、path 前：path 以 `-` 开头时不被当作选项（语法 [options] <worktree>）
  args.push('--');
  args.push(path);
  await runGit(args, { cwd });
}

export async function pruneWorktrees(cwd: string): Promise<void> {
  await runGit(['worktree', 'prune'], { cwd });
}
