/** 摘樱桃/还原 hooks：各走独立 mutation 端点，共用 PickBody 载荷（冲突态由 operation/conflicts 查询承接，无响应回写） */
import useSWRMutation from 'swr/mutation';
import type { PickBody, PickOutcome } from '@rebased/contracts';
import { postJson } from './http';

/** 摘樱桃（mutation）：POST /api/repos/:repoId/cherry-pick → PickOutcome */
export function useCherryPick(repoId: string): { trigger: (body: PickBody) => Promise<PickOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/cherry-pick`,
    (key: string, { arg }: { arg: PickBody }) => postJson<PickOutcome>(key, arg),
  );
  return { trigger, isMutating };
}

/** 还原（mutation）：POST /api/repos/:repoId/revert → PickOutcome */
export function useRevert(repoId: string): { trigger: (body: PickBody) => Promise<PickOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/revert`,
    (key: string, { arg }: { arg: PickBody }) => postJson<PickOutcome>(key, arg),
  );
  return { trigger, isMutating };
}
