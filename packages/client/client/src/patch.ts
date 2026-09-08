/** 补丁 hooks：补丁列表 SWR 查询 + create/apply/delete 写操作 mutation（POST 子路径，响应显式回写 patches/status 缓存键） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { PatchApplyBody, PatchCreateBody, PatchDeleteBody, PatchImportShelf, PatchList, RepoStatus, ShelfList } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 补丁列表：GET /api/repos/:repoId/patches */
export function usePatches(repoId: string): SWRResponse<PatchList> {
  return useSWR<PatchList>(`/api/repos/${repoId}/patches`, getJson);
}

/** 创建补丁（mutation）：POST …/patches/create，响应（刷新列表）回写 usePatches 缓存 */
export function useCreatePatch(repoId: string): { trigger: (body: PatchCreateBody) => Promise<PatchList>; isMutating: boolean } {
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验（P2-C 教训：
  // 否则同键触发竞态 GET），回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/patches`,
    (key: string, { arg }: { arg: PatchCreateBody }) => postJson<PatchList>(`${key}/create`, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/patches`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** 应用补丁（mutation）：POST …/patches/apply，响应 RepoStatus 显式回写 status 缓存键（useRepoStatus 订阅） */
export function useApplyPatch(repoId: string): { trigger: (body: PatchApplyBody) => Promise<RepoStatus>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/patches`,
    (key: string, { arg }: { arg: PatchApplyBody }) => postJson<RepoStatus>(`${key}/apply`, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const status = await trigger(body);
      // 跨键回写：RepoStatus 结果写回 status 键（应用补丁改变工作区状态）
      await mutate(`/api/repos/${repoId}/status`, status, { revalidate: false });
      return status;
    },
    isMutating,
  };
}

/** 删除补丁（mutation）：POST …/patches/delete，响应（刷新列表）回写 usePatches 缓存 */
export function useDeletePatch(repoId: string): { trigger: (body: PatchDeleteBody) => Promise<PatchList>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/patches`,
    (key: string, { arg }: { arg: PatchDeleteBody }) => postJson<PatchList>(`${key}/delete`, arg),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      await mutate(`/api/repos/${repoId}/patches`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** 导入补丁到搁置（mutation）：POST …/patches/:name/import-shelf，响应 ShelfList 回写 shelves 缓存键（useShelves 订阅）。
 *  说明：URL 含补丁名（trigger 的 arg），useSWRMutation 的 key 不入参 arg（SWR v2 serialize(key) 不传参），
 *  故 key 用占位标签、URL 在 fetcher 内经 arg 拼装；该 key 无对应 useSWR 查询，无缓存冲突。 */
export function useImportPatchIntoShelf(repoId: string): { trigger: (body: PatchImportShelf) => Promise<ShelfList>; isMutating: boolean } {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/patches/import-shelf`,
    (_key: string, { arg }: { arg: PatchImportShelf }) =>
      postJson<ShelfList>(`/api/repos/${repoId}/patches/${encodeURIComponent(arg.name)}/import-shelf`, { name: arg.name }),
    { revalidate: false },
  );
  return {
    trigger: async (body) => {
      const list = await trigger(body);
      // 跨键回写：导入的搁置结果写回 shelves 键（导入补丁改变搁置状态）
      await mutate(`/api/repos/${repoId}/shelves`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}
