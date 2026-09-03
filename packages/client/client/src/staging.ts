/** 暂存 hooks：文件级/hunk 级 mutation（POST，响应即最新 RepoStatus，显式回写 status 缓存键） */
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { HunkStagingBody, RepoStatus, StagingBody } from '@rebased/contracts';
import { postJson } from './http';

/** 文件级暂存操作：POST /api/repos/:repoId/staging，响应（最新 RepoStatus）回写 status SWR 缓存键 */
export function useStaging(repoId: string): { trigger: (body: StagingBody) => Promise<RepoStatus>; isMutating: boolean } {
  // staging 端点与 status 查询键不同，无法用 populateCache；改用上下文 mutate 跨键回写
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/staging`,
    (key: string, { arg }: { arg: StagingBody }) => postJson<RepoStatus>(key, arg),
  );
  return {
    trigger: async (body) => {
      const status = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/status`, status, { revalidate: false });
      return status;
    },
    isMutating,
  };
}

/** hunk 级暂存操作：POST …/staging/hunks，响应同样回写 status 缓存 */
export function useHunkStaging(repoId: string): { trigger: (body: HunkStagingBody) => Promise<RepoStatus>; isMutating: boolean } {
  // 回写约定同 useStaging
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/staging/hunks`,
    (key: string, { arg }: { arg: HunkStagingBody }) => postJson<RepoStatus>(key, arg),
  );
  return {
    trigger: async (body) => {
      const status = await trigger(body);
      await mutate(`/api/repos/${repoId}/status`, status, { revalidate: false });
      return status;
    },
    isMutating,
  };
}
