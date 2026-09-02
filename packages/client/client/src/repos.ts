/** 仓库 hooks：最近列表 SWR + 打开仓库 mutation（不持业务逻辑，薄封装端点） */
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import type { OpenRepoBody, RepoInfo, RepoStatus } from '@rebased/contracts';
import { getJson, postJson } from './http';

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
