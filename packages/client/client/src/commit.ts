/** 提交 hook：POST …/commit → {hash}；POST …/commit/push 组合执行器（薄封装端点，不持业务逻辑） */
import useSWRMutation from 'swr/mutation';
import type { CommitAndPushBody, CommitAndPushOutcome, CommitBody } from '@rebased/contracts';
import { postJson } from './http';

/** 提交：POST /api/repos/:repoId/commit → {hash}；成功后由调用方触发 log/status 刷新（events 推送亦覆盖） */
export function useCommit(repoId: string): { trigger: (body: CommitBody) => Promise<{ hash: string }>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/commit`,
    (key: string, { arg }: { arg: CommitBody }) => postJson<{ hash: string }>(key, arg),
  );
  return { trigger, isMutating };
}

/** commit & push 组合执行器：POST /api/repos/:repoId/commit/push → CommitAndPushOutcome（commit 已落盘 + push 业务结果）；
 *  失败语义与 Java 一致——提交先落盘，推送失败如实上报（调用方按 push.status 分派提示） */
export function useCommitAndPush(repoId: string): {
  trigger: (body: CommitAndPushBody) => Promise<CommitAndPushOutcome>;
  isMutating: boolean;
} {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/commit/push`,
    (key: string, { arg }: { arg: CommitAndPushBody }) => postJson<CommitAndPushOutcome>(key, arg),
  );
  return { trigger, isMutating };
}
