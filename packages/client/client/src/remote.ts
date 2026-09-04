/** 远程 hooks：远程列表 SWR 查询 + 远程写操作 mutation（POST 同路径，响应即最新远程列表，显式回写 remotes 缓存键）
 *  + fetch/pull/push 即发即弃突变（各自端点键；返回操作结果而非缓存域状态，故无回写——引用/状态变化经 refs.changed 等事件推送刷新） */
import useSWR, { useSWRConfig, type SWRResponse } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { FetchBody, FetchResult, PullBody, PullOutcome, PushBody, PushOutcome, RemoteAction, RemoteList } from '@rebased/contracts';
import { getJson, postJson } from './http';

/** 远程列表：GET /api/repos/:repoId/remotes */
export function useRemotes(repoId: string): SWRResponse<RemoteList> {
  return useSWR<RemoteList>(`/api/repos/${repoId}/remotes`, getJson);
}

/** 远程写操作（mutation）：POST 同路径（add/remove/setUrl），响应（刷新列表）回写 useRemotes 缓存（同键纪律同 stash hooks） */
export function useRemoteAction(repoId: string): { trigger: (action: RemoteAction) => Promise<RemoteList>; isMutating: boolean } {
  // 用上下文 mutate 显式回写 remotes 缓存键
  // （假设所有 hooks 共享同一 SWRConfig provider——应用当前依赖全局缓存）
  // mutation 键与查询键相同：revalidate:false 关掉 useSWRMutation 完成后的自动重校验，
  // 回写由下方显式 mutate 负责（populateCache 默认 false，不重复写缓存）
  const { mutate } = useSWRConfig();
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/remotes`,
    (key: string, { arg }: { arg: RemoteAction }) => postJson<RemoteList>(key, arg),
    { revalidate: false },
  );
  return {
    trigger: async (action) => {
      const list = await trigger(action);
      // revalidate:false 避免随后的 GET 覆盖刚回写的新值
      await mutate(`/api/repos/${repoId}/remotes`, list, { revalidate: false });
      return list;
    },
    isMutating,
  };
}

/** fetch（mutation）：POST /api/repos/:repoId/fetch（body 缺省 = 全部远程）；
 *  返回 FetchResult（操作结果，非查询缓存的域状态）→ 无回写；引用变化由 refs.changed 事件推送，页面经事件刷新 */
export function useFetch(repoId: string): { trigger: (body?: FetchBody) => Promise<FetchResult>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/fetch`,
    (key: string, { arg }: { arg?: FetchBody }) => postJson<FetchResult>(key, arg ?? {}),
  );
  return { trigger, isMutating };
}

/** pull（mutation）：POST /api/repos/:repoId/pull；同 fetch——返回 PullOutcome 操作结果，无回写，页面经事件刷新 */
export function usePull(repoId: string): { trigger: (body?: PullBody) => Promise<PullOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/pull`,
    (key: string, { arg }: { arg?: PullBody }) => postJson<PullOutcome>(key, arg ?? {}),
  );
  return { trigger, isMutating };
}

/** push（mutation）：POST /api/repos/:repoId/push；同 fetch——返回 PushOutcome 操作结果，无回写，页面经事件刷新 */
export function usePush(repoId: string): { trigger: (body?: PushBody) => Promise<PushOutcome>; isMutating: boolean } {
  const { trigger, isMutating } = useSWRMutation(
    `/api/repos/${repoId}/push`,
    (key: string, { arg }: { arg?: PushBody }) => postJson<PushOutcome>(key, arg ?? {}),
  );
  return { trigger, isMutating };
}
