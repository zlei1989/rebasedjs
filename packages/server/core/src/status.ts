/** status 解析：--porcelain=v2 -z --branch，NUL 分隔，文件名任意字符安全。 */
import { runGit } from './exec';

export interface CoreChangeEntry {
  path: string;
  code: string;
  renameFrom?: string;
}

export interface CoreStatus {
  branch: string | null;
  upstream: string | null;
  /** HEAD 提交哈希（branch.oid；干净提交也变化，是仓库状态变更检测的关键信号） */
  headHash: string | null;
  ahead: number;
  behind: number;
  entries: CoreChangeEntry[];
}

/** 解析 porcelain v2 记录流（# branch.* 头部 + 1/2/?/! 条目） */
export function parsePorcelainV2(raw: string): CoreStatus {
  const s: CoreStatus = { branch: null, upstream: null, headHash: null, ahead: 0, behind: 0, entries: [] };
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('# branch.oid ')) s.headHash = record.slice(13);
    else if (record.startsWith('# branch.head ')) s.branch = record.slice(14);
    else if (record.startsWith('# branch.upstream ')) s.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const m = record.match(/\+(\d+) -(\d+)/);
      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (record.startsWith('1 ')) {
      const parts = record.split(' ');
      s.entries.push({ path: parts.slice(8).join(' '), code: parts[1] });
    } else if (record.startsWith('2 ')) {
      // -z 模式：`2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`，origPath 是下一条 NUL 记录
      const parts = record.slice(2).split(' ');
      const path = parts.slice(8).join(' ');
      const next = records[i + 1];
      const renameFrom = next !== undefined && next !== '' && !/^(# |1 |2 |\? |! )/.test(next) ? next : undefined;
      s.entries.push({ path, code: parts[0], renameFrom });
      if (renameFrom !== undefined) i++; // 消费 origPath 记录
    } else if (record.startsWith('u ')) {
      // 冲突记录：`u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
      //（-z 下 path 为 NUL 结尾字段；实测空格分隔共 10 字段，path 下标 9，含空格文件名由 join 还原）
      const parts = record.slice(2).split(' ');
      s.entries.push({ path: parts.slice(9).join(' '), code: parts[0] });
    } else if (record.startsWith('? ')) {
      s.entries.push({ path: record.slice(2), code: '??' });
    } else if (record.startsWith('! ')) {
      s.entries.push({ path: record.slice(2), code: '!!' });
    }
  }
  return s;
}

export async function getStatus(repoPath: string): Promise<CoreStatus> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '-z', '--branch'], { cwd: repoPath });
  return parsePorcelainV2(stdout);
}
