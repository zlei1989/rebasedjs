/** Update Project hook：POST …/update（fetch 全远程 + 策略化 pull）→ UpdateOutcome（薄封装端点，不持业务逻辑） */
import useSWRMutation from 'swr/mutation';
import type { ForcePushedUpdateOutcome, UpdateBody, UpdateOutcome } from '@rebased/contracts';
import { postJson } from './http';

/** Update Project（mutation）：POST /api/repos/:repoId/update（strategy: merge|rebase）；
 *  返回 UpdateOutcome（操作结果，非查询缓存的域状态）→ 无回写；引用/状态变化由 refs.changed 等事件推送，页面经事件刷新 */
export function useUpdateProject(repoId: string): { trigger: (body: UpdateBody) => Promise<UpdateOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/update`,
    (key: string, { arg }: { arg: UpdateBody }) => postJson<UpdateOutcome>(key, arg),
  );
  return { trigger, isMutating };
}

/** force-push 后修复（mutation）：POST /api/repos/:repoId/update/force-pushed → ForcePushedUpdateOutcome
 *  （fetch → 本地重置到上游 → 本地独有提交重放；无请求体） */
export function useForcePushedUpdate(repoId: string): {
  trigger: () => Promise<ForcePushedUpdateOutcome>;
  isMutating: boolean;
} {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/update/force-pushed`,
    (key: string) => postJson<ForcePushedUpdateOutcome>(key, {}),
  );
  return { trigger, isMutating };
}
