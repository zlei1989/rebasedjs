/** 设置 hooks：GET /api/settings + update 突变（PUT，响应回写 SWR 缓存）+ git 可执行文件检测 + GPG 签名配置（repo 级） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { GitExecutableInfo, GpgConfigBody, GpgConfigView, SettingsPatch, SettingsState } from '@rebased/contracts';
import { getJson, putJson } from './http';

/** 应用设置：settings 为当前值，update(patch) 提交 PUT 并以服务端响应更新缓存 */
export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<SettingsState>('/api/settings', getJson);
  const { trigger, isMutating } = useSWRMutation(
    '/api/settings',
    (key: string, { arg }: { arg: SettingsPatch }) => putJson<SettingsState>(key, arg),
    // populateCache 回写响应；revalidate:false 避免随后的 GET 覆盖新值
    { populateCache: true, revalidate: false },
  );
  return { settings: data, error, isLoading, mutate, update: trigger, isUpdating: isMutating };
}

/** git 可执行文件检测（GitExecutableSelectorPanel 语义）：GET /api/settings/git-executable → GitExecutableInfo */
export function useGitExecutableInfo(): SWRResponse<GitExecutableInfo> {
  return useSWR<GitExecutableInfo>('/api/settings/git-executable', getJson);
}

/** GPG 提交签名配置（GitGpgConfigDialog 语义）：GET …/settings/gpg-config → GpgConfigView（启用态 + 选定密钥 + 可用密钥列表） */
export function useGpgConfig(repoId: string): SWRResponse<GpgConfigView> {
  return useSWR<GpgConfigView>(`/api/repos/${repoId}/settings/gpg-config`, getJson);
}

/** GPG 签名配置写入（mutation）：PUT 同路径，响应（刷新视图）回写 useGpgConfig 缓存键 */
export function useSetGpgConfig(repoId: string): {
  trigger: (body: GpgConfigBody) => Promise<GpgConfigView>;
  isMutating: boolean;
} {
  const { mutate } = useSWRConfig();
  const key = `/api/repos/${repoId}/settings/gpg-config`;
  const { trigger, isMutating } = useSWRMutation(
    key,
    (k: string, { arg }: { arg: GpgConfigBody }) => putJson<GpgConfigView>(k, arg),
  );
  return {
    trigger: async (body) => {
      const view = await trigger(body);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值（既有回写约定，见 useBranchAction）
      await mutate(key, view, { revalidate: false });
      return view;
    },
    isMutating,
  };
}
