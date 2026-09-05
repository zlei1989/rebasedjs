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
  /** 该行在责任提交版本中的源行号（源自块头 orig 字段）；在无位移编辑/重命名场景恰等同于前一次提交中的行号，插入/位移编辑时可能指向无关行——精确映射留待增强；无则 null——如文件首创建 */
  previousLineno: number | null;
}

/** 块起始行：<40/64 位 hex> <orig> <final> [<cnt>]（sha1/sha256 长度兼容） */
const HEADER_RE = /^[0-9a-f]{40,64} (\d+) (\d+)(?: (\d+))?$/;

/**
 * 解析 --line-porcelain 全文为逐行溯源数组。
 * 算法（单遍状态机）：起始行重置本块累积的 hash/orig/final 与头字段；
 * 头字段按前缀识别（author/author-mail/author-time/author-tz/previous），其余（committer*、summary、
 * boundary、filename、merged）不计——filename 的 C 引号转义不参与解析；
 * 遇到 \t 内容行即把本块沉淀为一条记录（\t 后原样取内容，可为空、可含 \t），
 * 块间无分隔符，靠起始行行首重置；最后一块由 EOF 收尾。
 * 日期：author-time（epoch 秒）+ author-tz（+0800 形）→ %aI 等价的「作者时区墙钟」偏移 ISO——
 * 与 history/committed/search 的 %aI 显示口径一致（ui 的 formatCommitDate 直取字符串，若产出 UTC Z
 * 则非 UTC 作者的墙钟会错到前一天，见终审裁定）；无 author-tz 时回退 toISOString（UTC Z）。
 */
export function parseBlamePorcelain(stdout: string): CoreBlameLine[] {
  const result: CoreBlameLine[] = [];
  let hash = '';
  let lineno = 0;
  let origLineno = 0;
  let author = '';
  let authorMail = '';
  let authorTimeSecs = 0;
  let authorTz = '';
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
      authorTz = '';
      hasPrevious = false;
    } else if (line.startsWith('\t')) {
      result.push({
        lineno,
        hash,
        shortHash: hash.slice(0, 7),
        author,
        authorEmail: authorMail.replace(/^<|>$/g, ''),
        dateIso: formatAuthorIso(authorTimeSecs, authorTz),
        content: line.slice(1),
        previousLineno: hasPrevious ? origLineno : null,
      });
    } else if (line.startsWith('author ')) {
      author = line.slice('author '.length);
    } else if (line.startsWith('author-mail ')) {
      authorMail = line.slice('author-mail '.length);
    } else if (line.startsWith('author-time ')) {
      authorTimeSecs = Number(line.slice('author-time '.length));
    } else if (line.startsWith('author-tz ')) {
      authorTz = line.slice('author-tz '.length);
    } else if (line.startsWith('previous ')) {
      hasPrevious = true;
    }
  }
  return result;
}

/** author-time（epoch 秒）+ author-tz（±HHMM 形）→ %aI 等价偏移 ISO（如 +0800 → 2026-01-01T10:00:00+08:00）。
 *  算法：墙钟 = UTC 时刻 + 时区偏移（分钟级），再取 UTC 字段拼装——不依赖运行时区，结果确定；
 *  tz 形不合法/缺失时回退 toISOString（UTC Z，尽力口径）。 */
function formatAuthorIso(epochSecs: number, tz: string): string {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(tz);
  if (!m) return new Date(epochSecs * 1000).toISOString();
  const offsetMin = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === '-' ? -1 : 1);
  const wall = new Date(epochSecs * 1000 + offsetMin * 60000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}${m[1]}${m[2]}:${m[3]}`;
}

/** 单文件逐行溯源：--line-porcelain 一次取全量（文件行数不大，无分页场景） */
export async function fileBlame(cwd: string, file: string): Promise<CoreBlameLine[]> {
  const { stdout } = await runGit(['blame', '--line-porcelain', '--', file], { cwd });
  return parseBlamePorcelain(stdout);
}
