/** 检出 hook：POST /api/repos/:repoId/checkout，响应即最新 RepoStatus，显式回写 status 缓存键 */
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { CheckoutAction, RepoStatus } from '@rebased/contracts';
import { postJson } from './http';

/** 检出（mutation）：POST /api/repos/:repoId/checkout，响应 RepoStatus 回写 status 缓存键 */
export function useCheckout(repoId: string): { trigger: (action: CheckoutAction) => Promise<RepoStatus>; isMutating: boolean } {
  // 回写约定同 useStaging：跨键显式回写
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/checkout`,
    (key: string, { arg }: { arg: CheckoutAction }) => postJson<RepoStatus>(key, arg),
  );
  return {
    trigger: async (action) => {
      const status = await trigger(action);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/status`, status, { revalidate: false });
      return status;
    },
    isMutating,
  };
}
