/** reset hooks：Reset / 撤销最近提交 mutation（POST，响应即最新 RepoStatus，显式回写 status 缓存键） */
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { RepoStatus, ResetBody } from '@rebased/contracts';
import { postJson } from './http';

/** Reset（mutation）：POST /api/repos/:repoId/reset，响应 RepoStatus 回写 status 缓存键；
 *  跨键 useSWRConfig().mutate 假设所有 hooks 共享同一 SWRConfig provider（应用当前依赖全局缓存） */
export function useReset(repoId: string): { trigger: (body: ResetBody) => Promise<RepoStatus>; isMutating: boolean } {
  // reset 端点与 status 查询键不同，无法用 populateCache；改用上下文 mutate 跨键回写
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/reset`,
    (key: string, { arg }: { arg: ResetBody }) => postJson<RepoStatus>(key, arg),
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

/** 撤销最近提交（mutation）：POST …/reset/undo-commit（无体），响应回写 status 缓存（回写约定同 useReset） */
export function useUndoCommit(repoId: string): { trigger: () => Promise<RepoStatus>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/reset/undo-commit`,
    (key: string) => postJson<RepoStatus>(key, {}),
  );
  return {
    trigger: async () => {
      const status = await trigger();
      await mutate(`/api/repos/${repoId}/status`, status, { revalidate: false });
      return status;
    },
    isMutating,
  };
}
