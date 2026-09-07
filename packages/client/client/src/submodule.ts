/** submodule hooks：列表查询 + 更新 mutation（响应为服务端重查的完整列表，显式回写 submodules 键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { SubmoduleList, SubmoduleUpdateBody } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** submodule 列表键：GET /api/repos/:repoId/submodules（update 响应 = 刷新后的同一列表形状） */
const submodulesKey = (repoId: string): string => `/api/repos/${repoId}/submodules`;

/** submodule 列表：GET /api/repos/:repoId/submodules */
export function useSubmodules(repoId: string): SWRResponse<SubmoduleList> {
  return useSWR<SubmoduleList>(submodulesKey(repoId), getJson);
}

/** 更新 submodule（mutation）：POST /api/repos/:repoId/submodules/update，响应（刷新列表）显式回写 submodules 键 */
export function useUpdateSubmodules(repoId: string): { trigger: (body: SubmoduleUpdateBody) => Promise<SubmoduleList>; isMutating: boolean } {
  // mutation 端点与列表查询键不同键，无法用 populateCache；改用上下文 mutate 跨键回写
  // revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训，mutation 键不触发竞态 GET），
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/submodules/update`,
    (key: string, { arg }: { arg: SubmoduleUpdateBody }) => postJson<SubmoduleList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(submodulesKey(repoId), list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
