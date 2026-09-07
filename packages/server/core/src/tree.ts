/**
 * 树对象原语：指定修订版本的文件树枚举（git ls-tree -r）。
 * 供 browse（历史快照浏览）使用：以某提交为根的只读文件树。
 * -r 只列叶子（blob/commit 子模块），目录节点由上层按路径前缀聚合；
 * NUL 分隔输出（-z），任意路径字符安全（含空格/换行）。
 */
import { runGit } from './exec';

/** 树条目：mode 为 8 进制数字串（100644/100755/120000=符号链接/160000=子模块）；type 为 git 类型（blob/commit） */
export interface CoreTreeEntry {
  mode: string;
  type: 'blob' | 'commit';
  hash: string;
  path: string;
}

/**
 * 解析 git ls-tree -r -z 输出：记录以 \0 分隔，每条 `mode SP type SP hash TAB path`。
 * 空输出（空文件树——如空提交）→ []；跳过空记录兜底（CRLF 环境）。
 */
export function parseTreeList(stdout: string): CoreTreeEntry[] {
  const entries: CoreTreeEntry[] = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const meta = record.slice(0, tab).split(' ');
    if (meta.length !== 3) continue;
    entries.push({ mode: meta[0], type: meta[1] === 'commit' ? 'commit' : 'blob', hash: meta[2], path: record.slice(tab + 1) });
  }
  return entries;
}

/** 指定修订版本的递归文件树：rev 为任意 tree-ish（提交/分支/标签/树哈希）；无效 rev 由 git 报错上抛 */
export async function listTreeAtRevision(cwd: string, rev: string): Promise<CoreTreeEntry[]> {
  const { stdout } = await runGit(['ls-tree', '-r', '-z', rev], { cwd });
  return parseTreeList(stdout);
}
