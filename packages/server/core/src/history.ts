/**
 * history 原语：git log --follow 文件历史（--follow 跟随重命名，最新在前）。
 *
 * 格式：--format=%H%x00%h%x00%s%x00%an%x00%aI——每条记录 5 个字段、字段间 \x00，
 * 记录之间 git 只以换行结尾（无 NUL），故记录边界是 \n 而非字段组；subject 不含换行/NUL。
 * 参数序：--follow 为无参旗标（无吞参问题），--format=… 用等号内联，先旗标后路径 `--` 分隔。
 */
import { runGit } from './exec';

/** 文件历史条目：逐字段对应 contracts 的 FileHistoryEntry（core 层持 Core 前缀镜像，api 层映射；parents 供根提交降级与 diff 导航） */
export interface CoreFileHistoryEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  dateIso: string;
  /** 父提交哈希（%P 空格分隔解析）；根提交为空数组 */
  parents: string[];
}

/** %H%x00%h%x00%s%x00%an%x00%aI%x00%P —— 每条记录 6 字段、字段间 \x00，记录间换行 */
const HISTORY_FORMAT = '%H%x00%h%x00%s%x00%an%x00%aI%x00%P';

/**
 * 解析 --format 的 NUL 分隔输出为条目数组。
 * 算法：记录以 \n 为界（git 每条记录以换行结尾，记录间无 NUL——NUL 只在字段间，
 * 每条记录 6 字段 5 个 NUL，按 NUL 直接分组会在记录边界错位）；
 * 先按 \n 切记录、再按 \0 切字段；末尾字段上剥记录尾随换行（兼容 \r\n 环境）。
 */
export function parseHistoryRecords(stdout: string): CoreFileHistoryEntry[] {
  const entries: CoreFileHistoryEntry[] = [];
  for (const record of stdout.split('\n')) {
    if (record.trim() === '') continue;
    const [hash, shortHash, subject, author, dateIso, parents] = record.split('\0');
    if (hash === undefined || shortHash === undefined || subject === undefined || author === undefined || dateIso === undefined) continue;
    entries.push({
      hash,
      shortHash,
      subject,
      author,
      dateIso: dateIso.replace(/\r$/, ''),
      parents: parents === undefined ? [] : parents.trim().split(' ').filter((p) => p !== ''),
    });
  }
  return entries;
}

/** 单文件历史（--follow 跟随重命名，最新在前）；文件不存在由 git 报错上抛 */
export async function fileHistory(cwd: string, file: string): Promise<CoreFileHistoryEntry[]> {
  const { stdout } = await runGit(['log', '--follow', `--format=${HISTORY_FORMAT}`, '--', file], { cwd });
  return parseHistoryRecords(stdout);
}
