/**
 * search 功能：提交搜索——grep（提交信息全文，--grep -i）与 pickaxe（内容增量，-S）两种模式。
 * 入参 query 由调用方经 searchQuerySchema 解析（q 必填/mode 枚举/limit≤100），本层直接透传 core。
 * 错误映射（P3-C 终审）：grep 的 q 按正则交给 git，非法正则（如 `[`/`fix(`）git 以 128
 * 'Invalid regular expression' 退出——映射为 INVALID_QUERY（调用方输入问题），而非 GIT_ERROR 500。
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

/** 提交搜索：按模式转发 core（q 原样传参、limit 截断均在 core 完成），逐条映射；无命中为 []。
 *  git 以正则处理 --grep：非法正则特征串映射为 INVALID_QUERY（沿用 conflict/diff 的特征串判定手法） */
export async function searchCommitsService(repoPath: string, query: SearchQuery): Promise<SearchResult[]> {
  try {
    const hits = await searchCommits(repoPath, { q: query.q, mode: query.mode, limit: query.limit });
    return hits.map(toSearchResult);
  } catch (err) {
    if (err instanceof GitExitError && err.exitCode === 128 && err.stderr.includes('Invalid regular expression')) {
      throw new ServiceError('INVALID_QUERY', '搜索表达式不是合法的正则表达式');
    }
    throw err;
  }
}
