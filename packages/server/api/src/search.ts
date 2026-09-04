/**
 * search 功能：提交搜索——grep（提交信息全文，--grep -i）与 pickaxe（内容增量，-S）两种模式。
 * 入参 query 由调用方经 searchQuerySchema 解析（q 必填/mode 枚举/limit≤100），本层直接透传 core。
 * 日期透传：dateIso 为 %aI 原样透传（带时区偏移的 ISO），消费方用 new Date() 解析（与 history/committed 同列）。
 */
import { searchCommits, type CoreSearchResult } from '@rebased/core';
import type { SearchQuery, SearchResult } from '@rebased/contracts';

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

/** 提交搜索：按模式转发 core（q 原样传参、limit 截断均在 core 完成），逐条映射；无命中为 [] */
export async function searchCommitsService(repoPath: string, query: SearchQuery): Promise<SearchResult[]> {
  const hits = await searchCommits(repoPath, { q: query.q, mode: query.mode, limit: query.limit });
  return hits.map(toSearchResult);
}
