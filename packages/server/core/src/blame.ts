/**
 * blame 原语：git blame --line-porcelain 逐行溯源解析。
 *
 * porcelain 块结构（实测 git 2.47，与 builtin/blame.c 的 emit_porcelain 对照印证）：
 * - 块起始行「<hash> <orig> <final> [<cnt>]」——组内首行含 cnt（组内行数）；
 *   --line-porcelain 下每条内容行前都有独立起始行，组内续行省略 cnt 但重复完整头字段；
 * - 头字段：author/author-mail/author-time/author-tz/committer 系列/summary/boundary/filename/previous；
 * - 内容行以 \t 前缀，块以「新的起始行或 EOF」结束，块数恰等于文件行数。
 *
 * 注意：porcelain 的 previous 行实际格式为「previous <hash> <路径>」——git 不输出前一行号，
 * 故 previousLineno 取该行在责任提交版本中的源行号（起始行第二字段 orig），
 * 对重命名/无位移编辑恰等于「前一次提交中的行号」；无 previous 头（文件首创建/边界提交）为 null。
 */
import { runGit } from './exec';

/** 溯源行：逐字段对应 contracts 的 BlameLine（core 层持 Core 前缀镜像，api 层映射） */
export interface CoreBlameLine {
  /** 最终文件行号（1-based） */
  lineno: number;
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  dateIso: string;
  content: string;
  /** 该行由哪一行演化而来（前一次提交中的原行号；无则 null——如文件首创建） */
  previousLineno: number | null;
}

/** 块起始行：<40/64 位 hex> <orig> <final> [<cnt>]（sha1/sha256 长度兼容） */
const HEADER_RE = /^[0-9a-f]{40,64} (\d+) (\d+)(?: (\d+))?$/;

/**
 * 解析 --line-porcelain 全文为逐行溯源数组。
 * 算法（单遍状态机）：起始行重置本块累积的 hash/orig/final 与头字段；
 * 头字段按前缀识别（author/author-mail/author-time/previous），其余（author-tz、committer*、summary、
 * boundary、filename、merged）不计——filename 的 C 引号转义不参与解析；
 * 遇到 \t 内容行即把本块沉淀为一条记录（\t 后原样取内容，可为空、可含 \t），
 * 块间无分隔符，靠起始行行首重置；最后一块由 EOF 收尾。
 */
export function parseBlamePorcelain(stdout: string): CoreBlameLine[] {
  const result: CoreBlameLine[] = [];
  let hash = '';
  let lineno = 0;
  let origLineno = 0;
  let author = '';
  let authorMail = '';
  let authorTimeSecs = 0;
  let hasPrevious = false;
  for (const line of stdout.split('\n')) {
    const head = line.match(HEADER_RE);
    if (head) {
      const parts = line.split(' ');
      hash = parts[0];
      origLineno = Number(head[1]);
      lineno = Number(head[2]);
      author = '';
      authorMail = '';
      authorTimeSecs = 0;
      hasPrevious = false;
    } else if (line.startsWith('\t')) {
      result.push({
        lineno,
        hash,
        shortHash: hash.slice(0, 7),
        author,
        authorEmail: authorMail.replace(/^<|>$/g, ''),
        dateIso: new Date(authorTimeSecs * 1000).toISOString(),
        content: line.slice(1),
        previousLineno: hasPrevious ? origLineno : null,
      });
    } else if (line.startsWith('author ')) {
      author = line.slice('author '.length);
    } else if (line.startsWith('author-mail ')) {
      authorMail = line.slice('author-mail '.length);
    } else if (line.startsWith('author-time ')) {
      authorTimeSecs = Number(line.slice('author-time '.length));
    } else if (line.startsWith('previous ')) {
      hasPrevious = true;
    }
  }
  return result;
}

/** 单文件逐行溯源：--line-porcelain 一次取全量（文件行数不大，无分页场景） */
export async function fileBlame(cwd: string, file: string): Promise<CoreBlameLine[]> {
  const { stdout } = await runGit(['blame', '--line-porcelain', '--', file], { cwd });
  return parseBlamePorcelain(stdout);
}
