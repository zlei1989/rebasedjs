/** 设置 hooks：GET /api/settings + update 突变（PUT，响应回写 SWR 缓存） */
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import type { SettingsPatch, SettingsState } from '@rebased/contracts';
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
