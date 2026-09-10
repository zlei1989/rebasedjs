/**
 * search 功能：提交搜索——grep（提交信息全文，--grep -i）与 pickaxe（内容增量，-S）两种模式。
 * 入参 query 由调用方经 searchQuerySchema 解析（q 必填/mode 枚举/limit≤100），本层直接透传 core。
 * 错误映射（D-30）：grep 的 q 是正则——先在 api 层用 JS RegExp 预校验（非法即 INVALID_QUERY 400，
 * 带中文说明），再交给 git；git 侧仍可能有 JS 接受而 POSIX ERE 拒绝的写法，故保留按 stderr
 * 特征串兜底映射（特征串覆盖 git 的多种措辞：Invalid regular expression / Unmatched [ 或 ( / bracket expression）。
 * 日期透传：dateIso 为 %aI 原样透传（带作者时区偏移的 ISO；ui 消费方 formatCommitDate 直取字符串字段）。
 */
import { GitExitError, searchCommits, type CoreSearchResult } from '@rebased/core';
import { ServiceError, type SearchQuery, type SearchResult } from '@rebased/contracts';

/** core 搜索结果 → contracts SearchResult（字段同构，映射在此收敛） */
function toSearchResult(hit: CoreSearchResult): SearchResult {
  return {
    hash: hit.hash,
    shortHash: hit.shortHash,
    subject: hit.subject,
    author: hit.author,
    dateIso: hit.dateIso,
  };
}

/** git 对非法正则的 stderr 措辞随版本/写法而异（实测：`Unmatched [ or [^`、`Invalid regular expression`） */
const GIT_REGEX_ERROR_HINTS = [
  'Invalid regular expression',
  'Unmatched [',
  'Unmatched (',
  'bracket expression',
  'Invalid range end',
];

/** 提交搜索：按模式转发 core（q 原样传参、limit 截断均在 core 完成），逐条映射；无命中为 []。
 *  grep 模式先做正则预校验：把「用户输入问题」在动 git 之前收口为 INVALID_QUERY（400），
 *  避免把 `git log --grep=[ … 退出码 128` 这类内部命令行原文抛给用户（D-30） */
export async function searchCommitsService(repoPath: string, query: SearchQuery): Promise<SearchResult[]> {
  if (query.mode === 'grep') {
    try {
      new RegExp(query.q);
    } catch (err) {
      throw new ServiceError('INVALID_QUERY', `搜索表达式不是合法的正则表达式：${query.q}`, {
        context: { reason: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  try {
    const hits = await searchCommits(repoPath, { q: query.q, mode: query.mode, limit: query.limit });
    return hits.map(toSearchResult);
  } catch (err) {
    if (
      err instanceof GitExitError &&
      err.exitCode === 128 &&
      GIT_REGEX_ERROR_HINTS.some((hint) => err.stderr.includes(hint))
    ) {
      throw new ServiceError('INVALID_QUERY', `搜索表达式不是合法的正则表达式：${query.q}`);
    }
    throw err;
  }
}
