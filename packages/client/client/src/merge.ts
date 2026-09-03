/** 合并 hooks：发起合并 mutation（POST，响应 MergeOutcome 由调用方处理）+ 继续合并 mutation（POST 无请求体，响应 RepoStatus 回写 status 缓存键） */
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { MergeBody, MergeOutcome, RepoStatus } from '@rebased/contracts';
import { postJson } from './http';

/** 发起合并（mutation）：POST /api/repos/:repoId/merge → MergeOutcome */
export function useMerge(repoId: string): { trigger: (body: MergeBody) => Promise<MergeOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/merge`,
    (key: string, { arg }: { arg: MergeBody }) => postJson<MergeOutcome>(key, arg),
  );
  return { trigger, isMutating };
}

/** 继续合并（mutation）：POST …/merge/continue（无请求体），响应 RepoStatus 回写 status 缓存 */
export function useContinueMerge(repoId: string): { trigger: () => Promise<RepoStatus>; isMutating: boolean } {
  // merge/continue 端点与 status 查询键不同，无法用 populateCache；改用上下文 mutate 跨键回写
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/merge/continue`,
    (key: string) => postJson<RepoStatus>(key, {}),
  );
  return {
    trigger: async () => {
      const status = await trigger();
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/status`, status, { revalidate: false });
      return status;
    },
    isMutating,
  };
}
