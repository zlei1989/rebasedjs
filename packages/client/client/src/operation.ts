/** 进行中操作 hooks：GET 查询 + abort 突变（POST 空体，响应回写查询缓存） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { OperationState } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 进行中操作状态：GET /api/repos/:repoId/operation */
export function useOperation(repoId: string): SWRResponse<OperationState> {
  return useSWR<OperationState>(`/api/repos/${repoId}/operation`, getJson);
}

/** 中止当前操作（mutation）：POST operation/abort，响应回写 useOperation 缓存；
 *  跨键 useSWRConfig().mutate 假设所有 hooks 共享同一 SWRConfig provider（应用当前依赖全局缓存） */
export function useAbortOperation(repoId: string): { trigger: () => Promise<OperationState>; isMutating: boolean } {
  // abort 端点与查询键不同，无法用 populateCache；改用上下文 mutate 回写 useOperation 缓存
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/operation/abort`,
    (key: string) => postJson<OperationState>(key, {}),
  );
  return {
    trigger: async () => {
      const state = await trigger();
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/operation`, state, { revalidate: false });
      return state;
    },
    isMutating,
  };
}
