/**
 * search 原语：提交搜索（grep = 提交信息匹配；pickaxe = 内容增量搜索）。
 *
 * 两种模式共用同一输出布局：`--format=%H%x00%h%x00%s%x00%an%x00%aI`（5 字段 NUL 分隔，
 * 与 history/committed 一致），故解析直接复用 history 的 parseHistoryRecords。
 * grep：--grep=<q> -i（大小写不敏感正则，匹配提交信息全文）；pickaxe：-S<q>（字面量串，
 * 不加 --pickaxe-regex——字符串出现次数增/减的提交命中，即「加/删一行特定串」语义）。
 * 命中数用 --max-count=<limit> 截断。
 */
import { runGit } from './exec';
import { parseHistoryRecords } from './history';

/** 搜索结果条目：逐字段对应 contracts 的 SearchResult（core 层持 Core 前缀镜像，api 层映射） */
export interface CoreSearchResult {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  dateIso: string;
}

/** %H%x00%h%x00%s%x00%an%x00%aI —— 与 history/committed 同布局 */
const SEARCH_FORMAT = '%H%x00%h%x00%s%x00%an%x00%aI';

/**
 * 提交搜索（最新在前；无命中返回 []）。
 * q 按模式原样传参（argv 独立元素，无 shell 注入面）；limit 由 --max-count 截断。
 * 注意 --grep 匹配提交信息全文（subject + body），结果 subject 字段仍只取 %s 首行。
 */
export async function searchCommits(
  cwd: string,
  opts: { q: string; mode: 'grep' | 'pickaxe'; limit: number },
): Promise<CoreSearchResult[]> {
  const args =
    opts.mode === 'grep'
      ? ['log', `--grep=${opts.q}`, '-i', `--format=${SEARCH_FORMAT}`, `--max-count=${opts.limit}`]
      : ['log', `-S${opts.q}`, `--format=${SEARCH_FORMAT}`, `--max-count=${opts.limit}`];
  const { stdout } = await runGit(args, { cwd });
  return parseHistoryRecords(stdout);
}
