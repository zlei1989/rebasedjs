/** 仓库 git 配置 hooks：GET 查询 + PUT 突变（响应回写查询缓存，沿用 settings.ts 模式） */
import useSWR, { type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { ConfigPutBody, GitConfigView } from '@rebased/contracts';
import { getJson, putJson } from './http';

/** 仓库 git 配置：GET /api/repos/:repoId/config */
export function useRepoConfig(repoId: string): SWRResponse<GitConfigView> {
  return useSWR<GitConfigView>(`/api/repos/${repoId}/config`, getJson);
}

/** 写仓库级配置（mutation）：PUT 同路径，响应回写 useRepoConfig 缓存 */
export function useSetConfig(repoId: string): { trigger: (body: ConfigPutBody) => Promise<GitConfigView>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/config`,
    (key: string, { arg }: { arg: ConfigPutBody }) => putJson<GitConfigView>(key, arg),
    // populateCache 回写响应至同 key 的 useRepoConfig 缓存；revalidate:false 避免随后的 GET 覆盖新值
    { populateCache: true, revalidate: false },
  );
  return { trigger, isMutating };
}
