/** 提交 hook：POST …/commit → {hash}（薄封装端点，不持业务逻辑） */
import useSWRMutation from 'swr/mutation';
import type { CommitBody } from '@rebased/contracts';
import { postJson } from './http';

/** 提交：POST /api/repos/:repoId/commit → {hash}；成功后由调用方触发 log/status 刷新（events 推送亦覆盖） */
export function useCommit(repoId: string): { trigger: (body: CommitBody) => Promise<{ hash: string }>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/commit`,
    (key: string, { arg }: { arg: CommitBody }) => postJson<{ hash: string }>(key, arg),
  );
  return { trigger, isMutating };
}
