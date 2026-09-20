/** committed 功能 hooks：单提交变更文件（Show All Affected 语义 #34，SWR 只读）。
 *  历史：原含「已提交变更分页」useCommittedPage——该页（CommittedChangesPanel）已撤除，随之删除。 */
import useSWR, { type SWRResponse } from 'swr';
import type { CommittedEntry } from '@rebased/contracts';
import { getJson } from './http';

/** 单提交变更文件（Show All Affected 语义 #34）：GET /api/repos/:repoId/commits/:hash；hash 空串挂 null key 不发请求（条件拉取） */
export function useCommitFiles(repoId: string, hash: string): SWRResponse<CommittedEntry> {
  return useSWR<CommittedEntry>(hash === '' ? null : `/api/repos/${repoId}/commits/${encodeURIComponent(hash)}`, getJson);
}
