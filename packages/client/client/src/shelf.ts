/** 搁置 hooks：搁置列表 SWR 查询 + 搁置写操作 mutation（POST 同路径，响应即最新搁置列表，显式回写 shelves 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { ShelfAction, ShelfList } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 搁置列表：GET /api/repos/:repoId/shelves */
export function useShelves(repoId: string): SWRResponse<ShelfList> {
  return useSWR<ShelfList>(`/api/repos/${repoId}/shelves`, getJson);
}

/** 搁置操作（mutation）：POST 同路径，响应（刷新列表）回写 useShelves 缓存（显式 mutate key，同键回写约定同 stash hooks） */
export function useShelfAction(repoId: string): { trigger: (action: ShelfAction) => Promise<ShelfList>; isMutating: boolean } {
  // 用上下文 mutate 显式回写 shelves 缓存键
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验，
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/shelves`,
    (key: string, { arg }: { arg: ShelfAction }) => postJson<ShelfList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (action) => {
      const list = await trigger(action);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/shelves`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
