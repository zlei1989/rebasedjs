/** 贮藏 hooks：贮藏列表 SWR 查询 + 贮藏写操作 mutation（POST 同路径，响应即最新贮藏列表，显式回写 stashes 缓存键）+ Unstash As / 差异查询 */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { StashAction, StashDiff, StashList, StashUnstashAsBody } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 贮藏列表：GET /api/repos/:repoId/stashes */
export function useStashes(repoId: string): SWRResponse<StashList> {
  return useSWR<StashList>(`/api/repos/${repoId}/stashes`, getJson);
}

/** 贮藏差异：GET …/stashes/:index/diff；index 为 null 时挂 null key 不发请求（条件拉取，页面可无条件挂载） */
export function useStashDiff(repoId: string, index: number | null): SWRResponse<StashDiff | null> {
  return useSWR<StashDiff | null>(index === null ? null : `/api/repos/${repoId}/stashes/${index}/diff`, getJson);
}

/** Unstash As（mutation）：POST …/stashes/unstash-as {index,branch}（检出目标分支+apply），响应（刷新列表）回写 stashes 缓存键 */
export function useStashUnstashAs(repoId: string): { trigger: (body: StashUnstashAsBody) => Promise<StashList>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/stashes/unstash-as`,
    (key: string, { arg }: { arg: StashUnstashAsBody }) => postJson<StashList>(key, arg),
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值（约定同 useStashAction）
      await mutate(`/api/repos/${repoId}/stashes`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** 贮藏操作（mutation）：POST 同路径，响应（刷新列表）回写 useStashes 缓存（显式 mutate key，跨键回写约定同 staging hooks） */
export function useStashAction(repoId: string): { trigger: (action: StashAction) => Promise<StashList>; isMutating: boolean } {
  // 用上下文 mutate 显式回写 stashes 缓存键
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验，
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/stashes`,
    (key: string, { arg }: { arg: StashAction }) => postJson<StashList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (action) => {
      const list = await trigger(action);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/stashes`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
