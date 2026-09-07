/** 仓库 hooks：最近列表 SWR + 打开/初始化/克隆/移除 mutation + 宿主主目录（不持业务逻辑，薄封装端点） */
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import type { CloneRepoBody, InitRepoBody, OpenRepoBody, RepoInfo, RepoStatus } from '@rebased/contracts';
import { delJson, getJson, postJson } from './http';

/** 最近仓库列表：GET /api/repos */
export function useRecentRepos() {
  return useSWR<RepoInfo[]>('/api/repos', getJson);
}

/** 仓库工作区状态：GET /api/repos/:repoId/status */
export function useRepoStatus(repoId: string) {
  return useSWR<RepoStatus>(`/api/repos/${repoId}/status`, getJson);
}

/** 打开仓库（mutation）：POST /api/repos/open {path} → {repoId} */
export function useOpenRepo() {
  return useSWRMutation(
    '/api/repos/open',
    (key: string, { arg }: { arg: OpenRepoBody }) => postJson<{ repoId: string }>(key, arg),
  );
}

/** 初始化仓库（mutation）：POST /api/repos/init {path} → {repoId} */
export function useInitRepo() {
  return useSWRMutation(
    '/api/repos/init',
    (key: string, { arg }: { arg: InitRepoBody }) => postJson<{ repoId: string }>(key, arg),
  );
}

/** 克隆仓库（mutation）：POST /api/repos/clone {url,targetDir} → {repoId} */
export function useCloneRepo() {
  return useSWRMutation(
    '/api/repos/clone',
    (key: string, { arg }: { arg: CloneRepoBody }) => postJson<{ repoId: string }>(key, arg),
  );
}

/** 移除最近仓库（mutation）：DELETE /api/repos/:repoId（幂等）；列表刷新由容器 mutate 负责。
 *  说明：useSWRMutation 的 key 不入参 trigger 的 arg（SWR v2 serialize(key) 不传参），
 *  故 key 用占位标签、URL 在 fetcher 内经 arg 拼装；该 key 无对应 useSWR 查询，无缓存冲突。 */
export function useRemoveRepo() {
  return useSWRMutation(
    '/api/repos/:repoId',
    (_key: string, { arg }: { arg: string }) => delJson<{ ok: true }>(`/api/repos/${arg}`),
  );
}

/** 宿主用户主目录：GET /api/app/home-dir（路径副文本 ~/ 相对化用） */
export function useAppHomeDir() {
  return useSWR<{ homeDir: string }>('/api/app/home-dir', getJson);
}
