/** 提交搜索 hooks：grep=提交信息全文（--grep）/ pickaxe=内容增量（-S）；SWR 只读 */
import useSWR, { type SWRResponse } from 'swr';
import type { SearchMode, SearchResult } from '@rebased/contracts';
import { getJson } from './http';

/** 搜索提交：GET /api/repos/:repoId/search?q&mode（limit 由服务端默认 50；q 为空串时挂 null key 不发请求——输入清空不误发） */
export function useSearch(repoId: string, q: string, mode: SearchMode): SWRResponse<SearchResult[]> {
  const params = new URLSearchParams({ q, mode });
  return useSWR<SearchResult[]>(q === '' ? null : `/api/repos/${repoId}/search?${params.toString()}`, getJson);
}
