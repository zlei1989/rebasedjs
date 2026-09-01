/**
 * log 流式解析：--graph + 自定义分隔符。
 * 记录帧 = <graph列>\x01<7 字段以 \x1f 分隔>\x02；\x02 为记录边界，支持多行 message。
 */
import { streamGit } from './exec';

const FIELD_SEP = '\x1f';
const PREFIX_SEP = '\x01';
const RECORD_SEP = '\x02';
// --graph 图列字形：空格填充 + git 图字符（| * \ / _ .）
const GRAPH_CHARS = new Set([' ', '|', '*', '/', '\\', '_', '.']);

export interface CoreCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  dateIso: string;
  refs: string[];
  message: string;
  graph: string;
}

/**
 * 解析单条记录（graph 前缀 + \x01 + 字段）。
 * --graph 会把图列按固定宽度填充到 message 每个延续行的行首（如 '| '、'  '），
 * 这里按本记录未 trim 的图列宽度剥掉这些填充，再 trimEnd 掉 %B 结尾的换行。
 */
export function parseLogRecord(raw: string): CoreCommit {
  const i = raw.indexOf(PREFIX_SEP);
  const graph = raw.slice(0, i).trimEnd();
  const width = raw.slice(0, i).length;
  const body = raw.slice(i + 1, raw.endsWith(RECORD_SEP) ? -1 : undefined);
  const parts = body.split(FIELD_SEP);
  const [hash, shortHash, parentsStr, author, authorEmail, dateIso, refsStr, ...rest] = parts;
  return {
    hash,
    shortHash,
    parents: parentsStr === '' ? [] : parentsStr.split(' '),
    author,
    authorEmail,
    dateIso,
    refs: refsStr === '' ? [] : refsStr.split(', '),
    message: stripGraphLines(rest.join(FIELD_SEP), width).trimEnd(),
    graph,
  };
}

/** 剥掉 message 延续行的图列填充：只剥本记录图列宽度内的图字符 */
function stripGraphLines(message: string, width: number): string {
  return message
    .split('\n')
    .map((line, n) => {
      if (n === 0) return line;
      let k = 0;
      while (k < width && k < line.length && GRAPH_CHARS.has(line[k])) k++;
      return line.slice(k);
    })
    .join('\n');
}

export interface StreamLogOptions {
  skip?: number;
  maxCount?: number;
  author?: string;
  path?: string;
  signal?: AbortSignal;
}

/** 流式产出提交（逐条解析，不整库读入内存；分页用 --skip） */
export async function* streamLog(repoPath: string, opts: StreamLogOptions = {}): AsyncIterable<CoreCommit> {
  const args = ['log', '--graph', '--date-order', `--format=${PREFIX_SEP}%H${FIELD_SEP}%h${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%B${RECORD_SEP}`];
  if (opts.skip) args.push(`--skip=${opts.skip}`);
  if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
  if (opts.author) args.push(`--author=${opts.author}`);
  if (opts.path) args.push('--', opts.path);

  let buffer = '';
  for await (const chunk of streamGit(args, { cwd: repoPath, signal: opts.signal })) {
    buffer += chunk;
    let idx: number;
    // 以 \x02 切记录，保留尾部不完整帧
    while ((idx = buffer.indexOf(RECORD_SEP)) >= 0) {
      const record = buffer.slice(0, idx + 1);
      buffer = buffer.slice(idx + 1);
      // git 每条记录以换行结尾（格式终结符），不属于任何记录，吞掉以免污染下一条的图列
      if (buffer.startsWith('\n')) buffer = buffer.slice(1);
      if (record.trim().length > 1) yield parseLogRecord(record);
    }
  }
  if (buffer.trim().length > 0) yield parseLogRecord(buffer);
}
