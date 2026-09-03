/** 冲突 hooks：冲突列表/三版本内容 SWR 查询 + 解决冲突 mutation（POST …/resolve，响应即刷新列表，显式回写 conflicts 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { ConflictContents, ConflictList, ResolveConflictBody } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 冲突列表：GET /api/repos/:repoId/conflicts */
export function useConflicts(repoId: string): SWRResponse<ConflictList> {
  return useSWR<ConflictList>(`/api/repos/${repoId}/conflicts`, getJson);
}

/** 冲突三版本内容：GET …/conflicts/contents?path=；path 为空串时挂 null key 不发请求（条件拉取），页面可无条件挂载 */
export function useConflictContents(repoId: string, path: string): SWRResponse<ConflictContents> {
  const params = new URLSearchParams({ path });
  return useSWR<ConflictContents>(path === '' ? null : `/api/repos/${repoId}/conflicts/contents?${params.toString()}`, getJson);
}

/** 解决冲突（mutation）：POST …/conflicts/resolve，响应（刷新列表）回写 useConflicts 缓存 */
export function useResolveConflict(repoId: string): { trigger: (body: ResolveConflictBody) => Promise<ConflictList>; isMutating: boolean } {
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训：
  // 否则同键触发竞态 GET），回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/conflicts`,
    (key: string, { arg }: { arg: ResolveConflictBody }) => postJson<ConflictList>(`${key}/resolve`, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/conflicts`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
