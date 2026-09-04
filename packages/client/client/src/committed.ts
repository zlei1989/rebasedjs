/** Committed Changes 分页 hooks：历史提交及其变更文件（SWR 只读；返回完整 SWRResponse 供容器增量加载） */
import useSWR, { type SWRResponse } from 'swr';
import type { CommittedPage } from '@rebased/contracts';
import { getJson } from './http';

/** 拉取 Committed Changes 分页：GET /api/repos/:repoId/committed?limit&skip（limit/skip 省略时服务端默认 50/0；hasMore 供容器判断是否还有下一页） */
export function useCommittedPage(repoId: string, query?: Partial<{ limit: number; skip: number }>): SWRResponse<CommittedPage> {
  const params = new URLSearchParams();
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.skip !== undefined) params.set('skip', String(query.skip));
  const qs = params.toString();
  return useSWR<CommittedPage>(`/api/repos/${repoId}/committed${qs ? `?${qs}` : ''}`, getJson);
}
