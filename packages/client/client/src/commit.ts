/** 提交 hook：POST …/commit → {hash}；POST …/commit/push 组合执行器（薄封装端点，不持业务逻辑）；
 *  amend 指定历史提交（GitCommitDialog「Amend <subject>」语义）：GET …/commit/amend-targets 候选列表 + POST …/commit/amend-specific */
import useSWR, { type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { AmendSpecificBody, AmendTarget, CommitAndPushBody, CommitAndPushOutcome, CommitBody } from '@rebased/contracts';
import { getJson, postJson } from './http';

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

/** amend 目标候选：GET /api/repos/:repoId/commit/amend-targets → AmendTarget[]（未发布的非合并非 HEAD 提交，旧→新，上限 20） */
export function useAmendTargets(repoId: string): SWRResponse<AmendTarget[]> {
  return useSWR<AmendTarget[]>(repoId === '' ? null : `/api/repos/${repoId}/commit/amend-targets`, getJson);
}

/** amend 指定历史提交：POST /api/repos/:repoId/commit/amend-specific → {status, hash?}（success=重写完成；conflicts=冲突态交冲突页） */
export function useAmendSpecificCommit(repoId: string): {
  trigger: (body: AmendSpecificBody) => Promise<{ status: 'success' | 'conflicts'; hash?: string }>;
  isMutating: boolean;
} {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/commit/amend-specific`,
    (key: string, { arg }: { arg: AmendSpecificBody }) =>
      postJson<{ status: 'success' | 'conflicts'; hash?: string }>(key, arg),
  );
  return { trigger, isMutating };
}
