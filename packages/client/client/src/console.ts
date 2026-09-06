/** 控制台 hooks：命令执行记录查询（SWR 只读，limit 查询串可选） */
import useSWR, { type SWRResponse } from 'swr';
import type { ConsoleEntry } from '@rebased/contracts';
import { getJson } from './http';

/** 控制台记录：GET /api/repos/:repoId/console?limit=；limit 缺省不带查询串（服务端默认 100） */
export function useConsole(repoId: string, limit?: number): SWRResponse<ConsoleEntry[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  const qs = params.toString();
  return useSWR<ConsoleEntry[]>(`/api/repos/${repoId}/console${qs ? `?${qs}` : ''}`, getJson);
}
