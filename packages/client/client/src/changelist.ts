/** 变更列表 hooks：变更列表 SWR 查询 + 变更列表写操作 mutation（POST 同路径，响应即最新变更列表视图，显式回写 changelists 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { ChangelistAction, ChangelistView } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 变更列表视图：GET /api/repos/:repoId/changelists */
export function useChangelists(repoId: string): SWRResponse<ChangelistView> {
  return useSWR<ChangelistView>(`/api/repos/${repoId}/changelists`, getJson);
}

/** 变更列表操作（mutation）：POST 同路径（同键教训：mutation options revalidate:false + 显式 mutate 回写 useChangelists 缓存，约定同 staging/stash hooks） */
export function useChangelistAction(repoId: string): { trigger: (action: ChangelistAction) => Promise<ChangelistView>; isMutating: boolean } {
  // 用上下文 mutate 显式回写 changelists 缓存键
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验，
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/changelists`,
    (key: string, { arg }: { arg: ChangelistAction }) => postJson<ChangelistView>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (action) => {
      const view = await trigger(action);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/changelists`, view, { revalidate: false });
      return view;
    },
    isMutating,
  };
}
