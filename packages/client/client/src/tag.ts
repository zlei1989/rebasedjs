/** 标签 hooks：标签列表 SWR 查询 + 标签操作 mutation（POST 同路径，响应即最新标签列表，显式回写 tags 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { TagAction, TagList } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 标签列表：GET /api/repos/:repoId/tags */
export function useTags(repoId: string): SWRResponse<TagList> {
  return useSWR<TagList>(`/api/repos/${repoId}/tags`, getJson);
}

/** 标签操作（mutation）：POST 同路径，响应（刷新列表）回写 useTags 缓存（显式 mutate key，同键回写约定同 stash hooks） */
export function useTagAction(repoId: string): { trigger: (action: TagAction) => Promise<TagList>; isMutating: boolean } {
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验，
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/tags`,
    (key: string, { arg }: { arg: TagAction }) => postJson<TagList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (action) => {
      const list = await trigger(action);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/tags`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
