/** 变基 hooks：onto/交互式变基/auto-squash mutation（POST 各自端点）+ todo 数据源 SWR 查询（base 空串挂 null key 不发请求） */
import useSWR, { type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { AutosquashBody, InteractiveRebaseBody, RebaseBody, RebaseOutcome, TodoEntry } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 发起 onto 变基（mutation）：POST /api/repos/:repoId/rebase → RebaseOutcome（结果由调用方跳 conflicts 页或刷新日志） */
export function useRebase(repoId: string): { trigger: (body: RebaseBody) => Promise<RebaseOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/rebase`,
    (key: string, { arg }: { arg: RebaseBody }) => postJson<RebaseOutcome>(key, arg),
  );
  return { trigger, isMutating };
}

/** 交互式变基 todo 数据源：GET …/rebase/todo?base=；base 为空串时挂 null key 不发请求（条件拉取），页面可无条件挂载 */
export function useRebaseTodo(repoId: string, base: string): SWRResponse<TodoEntry[]> {
  const params = new URLSearchParams({ base });
  return useSWR<TodoEntry[]>(base === '' ? null : `/api/repos/${repoId}/rebase/todo?${params.toString()}`, getJson);
}

/** 发起交互式变基（mutation）：POST /api/repos/:repoId/rebase/interactive → RebaseOutcome */
export function useInteractiveRebase(repoId: string): {
  trigger: (body: InteractiveRebaseBody) => Promise<RebaseOutcome>;
  isMutating: boolean;
} {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/rebase/interactive`,
    (key: string, { arg }: { arg: InteractiveRebaseBody }) => postJson<RebaseOutcome>(key, arg),
  );
  return { trigger, isMutating };
}

/** auto-squash（mutation）：POST /api/repos/:repoId/autosquash → RebaseOutcome（fixup!/squash! 提交折入目标提交） */
export function useAutosquash(repoId: string): { trigger: (body: AutosquashBody) => Promise<RebaseOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/autosquash`,
    (key: string, { arg }: { arg: AutosquashBody }) => postJson<RebaseOutcome>(key, arg),
  );
  return { trigger, isMutating };
}
