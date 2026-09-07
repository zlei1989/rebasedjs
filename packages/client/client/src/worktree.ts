/** worktree hooks：列表查询 + 创建/移除/清理 mutation（响应为服务端重查的完整列表，显式回写 worktrees 键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { WorktreeCreateBody, WorktreeList, WorktreeRemoveBody } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** worktree 列表键：GET /api/repos/:repoId/worktrees（create/remove/prune 响应 = 刷新后的同一列表形状） */
const worktreesKey = (repoId: string): string => `/api/repos/${repoId}/worktrees`;

/** worktree 列表：GET /api/repos/:repoId/worktrees */
export function useWorktrees(repoId: string): SWRResponse<WorktreeList> {
  return useSWR<WorktreeList>(worktreesKey(repoId), getJson);
}

/** 创建 worktree（mutation）：POST /api/repos/:repoId/worktrees，响应（刷新列表）显式回写 worktrees 键 */
export function useCreateWorktree(repoId: string): { trigger: (body: WorktreeCreateBody) => Promise<WorktreeList>; isMutating: boolean } {
  // mutation 端点与列表查询键相同（同为 /worktrees），但 useSWRMutation 默认 populateCache:false 不写缓存；
  // revalidate:false 关掉完成后的自动重校验（P2-C 教训），回写由下方显式 mutate 负责
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    worktreesKey(repoId),
    (key: string, { arg }: { arg: WorktreeCreateBody }) => postJson<WorktreeList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(worktreesKey(repoId), list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** 移除 worktree（mutation）：POST /api/repos/:repoId/worktrees/remove，响应（刷新列表）显式回写 worktrees 键 */
export function useRemoveWorktree(repoId: string): { trigger: (body: WorktreeRemoveBody) => Promise<WorktreeList>; isMutating: boolean } {
  // mutation 端点与列表查询键不同键，无法用 populateCache；改用上下文 mutate 跨键回写
  // revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训，mutation 键不触发竞态 GET），
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/worktrees/remove`,
    (key: string, { arg }: { arg: WorktreeRemoveBody }) => postJson<WorktreeList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(worktreesKey(repoId), list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** 清理陈旧 worktree 条目（mutation）：POST /api/repos/:repoId/worktrees/prune（无请求体），响应（刷新列表）显式回写 worktrees 键 */
export function usePruneWorktrees(repoId: string): { trigger: () => Promise<WorktreeList>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/worktrees/prune`,
    (key: string) => postJson<WorktreeList>(key, {}),
    { revalidate: false },
  );
  return {
    trigger: async () => {
      const list = await trigger();
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(worktreesKey(repoId), list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
