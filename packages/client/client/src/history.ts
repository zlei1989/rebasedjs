/** 文件历史 hooks：单文件提交序列（git log --follow 跟随重命名；SWR 只读） */
import useSWR, { type SWRResponse } from 'swr';
import type { FileHistoryEntry } from '@rebased/contracts';
import { getJson } from './http';

/** 拉取单文件历史条目：GET /api/repos/:repoId/history?file（最新在前；file 为空串时挂 null key 不发请求——条件拉取，页面可无条件挂载） */
export function useHistory(repoId: string, file: string): SWRResponse<FileHistoryEntry[]> {
  const params = new URLSearchParams({ file });
  return useSWR<FileHistoryEntry[]>(file === '' ? null : `/api/repos/${repoId}/history?${params.toString()}`, getJson);
}
