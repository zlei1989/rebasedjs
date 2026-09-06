/** 忽略配置 hooks：忽略视图 SWR 查询 + 整写/追加 mutation（响应显式回写 ignore 缓存键）+ 内建模板查询 */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { IgnoreAddBody, IgnoreContents, IgnorePutBody, IgnoreTemplate } from '@rebased/contracts';
import { getJson, postJson, putJson } from './http';

/** 忽略配置视图：GET /api/repos/:repoId/ignore */
export function useIgnore(repoId: string): SWRResponse<IgnoreContents> {
  return useSWR<IgnoreContents>(`/api/repos/${repoId}/ignore`, getJson);
}

/** 整写忽略配置（mutation）：PUT 同路径，响应（刷新视图）回写 useIgnore 缓存 */
export function usePutIgnore(repoId: string): { trigger: (body: IgnorePutBody) => Promise<IgnoreContents>; isMutating: boolean } {
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训：
  // 否则同键触发竞态 GET），回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/ignore`,
    (key: string, { arg }: { arg: IgnorePutBody }) => putJson<IgnoreContents>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const contents = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/ignore`, contents, { revalidate: false });
      return contents;
    },
    isMutating,
  };
}

/** 追加忽略规则（mutation）：POST …/ignore/add（契约 body 仅 {path}），新 IgnoreContents 回写 useIgnore 缓存 */
export function useAddIgnore(repoId: string): { trigger: (body: IgnoreAddBody) => Promise<IgnoreContents>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/ignore`,
    (key: string, { arg }: { arg: IgnoreAddBody }) => postJson<IgnoreContents>(`${key}/add`, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const contents = await trigger(body);
      // 跨键回写：add 响应即新 IgnoreContents，写回 ignore 键
      await mutate(`/api/repos/${repoId}/ignore`, contents, { revalidate: false });
      return contents;
    },
    isMutating,
  };
}

/** 内建忽略模板：GET /api/repos/:repoId/ignore/templates（repoId 域端点，服务端仅校验不触盘） */
export function useIgnoreTemplates(repoId: string): SWRResponse<IgnoreTemplate[]> {
  return useSWR<IgnoreTemplate[]>(`/api/repos/${repoId}/ignore/templates`, getJson);
}
