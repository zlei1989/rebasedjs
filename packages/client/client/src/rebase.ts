/** 变基 hooks：onto/交互式变基/auto-squash/单提交编辑/检出并变基 mutation（POST 各自端点）+ todo 数据源 SWR 查询（base 空串挂 null key 不发请求） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { AutosquashBody, CheckoutRebaseBody, CheckoutUpdateBody, CommitEditBody, InteractiveRebaseBody, RebaseBody, RebaseOutcome, TodoEntry } from '@rebased/contracts';
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

/** 单提交编辑直通（mutation）：POST /api/repos/:repoId/commit-edit → RebaseOutcome（reword/drop/squash/fixup；reword 带 message） */
export function useCommitEdit(repoId: string): { trigger: (body: CommitEditBody) => Promise<RebaseOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/commit-edit`,
    (key: string, { arg }: { arg: CommitEditBody }) => postJson<RebaseOutcome>(key, arg),
  );
  return { trigger, isMutating };
}

/** 检出并变基到当前（mutation）：POST /api/repos/:repoId/checkout-rebase → RebaseOutcome（检出目标分支后 rebase onto
 *  变基前所在分支；远程分支 localName 为新本地名，缺省剥 origin/ 前缀）。分支切换 + 历史重写使 status/branches
 *  双缓存键失效，成功后显式重验证（事件推送不足以刷新 current 标记与分支列表）。 */
export function useCheckoutRebase(repoId: string): {
  trigger: (body: CheckoutRebaseBody) => Promise<RebaseOutcome>;
  isMutating: boolean;
} {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/checkout-rebase`,
    (key: string, { arg }: { arg: CheckoutRebaseBody }) => postJson<RebaseOutcome>(key, arg),
  );
  return {
    trigger: async (body) => {
      const outcome = await trigger(body);
      // 分支切换 + 历史重写：status（当前分支/headHash）与 branches（current 标记/远程行）均失效，重验证刷新
      await Promise.all([
        mutate(`/api/repos/${repoId}/status`),
        mutate(`/api/repos/${repoId}/branches`),
      ]);
      return outcome;
    },
    isMutating,
  };
}

/** 检出并更新（mutation）：POST /api/repos/:repoId/checkout-update → RebaseOutcome（检出本地分支后策略化更新：
 *  fetch 跟踪分支 + merge/--rebase，GitCheckoutWithUpdateAction 语义）。同 checkout-rebase——成功即双缓存键失效。 */
export function useCheckoutUpdate(repoId: string): {
  trigger: (body: CheckoutUpdateBody) => Promise<RebaseOutcome>;
  isMutating: boolean;
} {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/checkout-update`,
    (key: string, { arg }: { arg: CheckoutUpdateBody }) => postJson<RebaseOutcome>(key, arg),
  );
  return {
    trigger: async (body) => {
      const outcome = await trigger(body);
      await Promise.all([
        mutate(`/api/repos/${repoId}/status`),
        mutate(`/api/repos/${repoId}/branches`),
      ]);
      return outcome;
    },
    isMutating,
  };
}
