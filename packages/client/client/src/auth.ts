/** 账户 hooks：账户列表 SWR 查询 + 添加/覆盖、删除突变（应用级，无 repoId） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { AccountBody, AccountDeleteBody, AccountList } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 账户列表：GET /api/auth/accounts（应用级，无 repoId） */
export function useAccounts(): SWRResponse<AccountList> {
  return useSWR<AccountList>('/api/auth/accounts', getJson);
}

/** 添加/覆盖账户（mutation）：POST /api/auth/accounts，同键纪律（revalidate:false + 显式回写） */
export function useUpsertAccount(): { trigger: (body: AccountBody) => Promise<AccountList>; isMutating: boolean } {
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验，
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    '/api/auth/accounts',
    (key: string, { arg }: { arg: AccountBody }) => postJson<AccountList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate('/api/auth/accounts', list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** 删除账户（mutation）：POST /api/auth/accounts/delete，响应回写 useAccounts 缓存键（跨键回写约定） */
export function useDeleteAccount(): { trigger: (body: AccountDeleteBody) => Promise<AccountList>; isMutating: boolean } {
  // delete 端点与查询键不同，无法用 populateCache；改用上下文 mutate 回写 useAccounts 缓存
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    '/api/auth/accounts/delete',
    (key: string, { arg }: { arg: AccountDeleteBody }) => postJson<AccountList>(key, arg),
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate('/api/auth/accounts', list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
