/**
 * 仓库页共用导航装配（web-next 容器侧）：useRepoNav(repoId) 一处装配 RepoTopNav 所需的
 * 导航回调全集（仓库名 + 回首页 + 各仓库页路由 + GitHub/GitLab 可用性 + 仓库状态），
 * 各仓库页容器展开注入 `<RepoTopNav {...nav} current="xxx" />`，取代原先每页复制的「返回日志」链接。
 * 仓库名取 useRecentRepos（与日志页同源，缺省回落 repoId）；仓库状态（分支名 + ahead/behind）经
 * useRepoStatus 拉取——所有仓库页的顶栏都显示当前分支名（SWR 同键缓存，页面间切换零重复请求）；
 * GitHub/GitLab 可用性经 useGithubStatus/useGitlabStatus 检测（同样按键缓存）。
 * 拉取/推送/更新项目/变基四个「更多」对话框入口**不在此装配**——对话框状态只在日志页容器持有。
 */
import { useGithubStatus, useGitlabStatus, useRecentRepos, useRepoStatus } from '@rebased/client';
import type { RepoTopNavProps } from '@rebased/ui';
import { useRouter } from 'next/navigation';

/** useRepoNav 的返回形态：RepoTopNav 的导航回调子集（current 与日志页专属 props 由各页自给） */
export type RepoNavCallbacks = Pick<
  RepoTopNavProps,
  | 'repoName'
  | 'onGoHome'
  | 'onOpenLog'
  | 'onOpenStatus'
  | 'onOpenBranches'
  | 'onOpenMerge'
  | 'onOpenStashes'
  | 'onOpenSettings'
  | 'onOpenBlame'
  | 'onOpenHistory'
  | 'onOpenCommitted'
  | 'onOpenSearch'
  | 'onOpenTags'
  | 'onOpenRemotes'
  | 'onOpenPatches'
  | 'onOpenShelves'
  | 'onOpenConsole'
  | 'onOpenIgnore'
  | 'onOpenGithub'
  | 'githubAvailable'
  | 'onOpenGitlab'
  | 'gitlabAvailable'
  | 'onOpenWorktrees'
  | 'onOpenSubmodules'
  | 'status'
>;

export function useRepoNav(repoId: string): RepoNavCallbacks {
  const router = useRouter();
  const { data: repos } = useRecentRepos();
  const { data: githubStatus } = useGithubStatus(repoId);
  const { data: gitlabStatus } = useGitlabStatus(repoId);
  // 仓库状态：顶栏分支名 + ahead/behind（与状态页/日志页同键，SWR 缓存共享）
  const { data: status } = useRepoStatus(repoId);
  return {
    repoName: repos?.find((r) => r.id === repoId)?.name ?? repoId,
    status,
    onGoHome: () => router.push('/'),
    onOpenLog: () => router.push(`/repos/${repoId}`),
    onOpenStatus: () => router.push(`/repos/${repoId}/status`),
    onOpenBranches: () => router.push(`/repos/${repoId}/branches`),
    onOpenMerge: () => router.push(`/repos/${repoId}/merge`),
    onOpenStashes: () => router.push(`/repos/${repoId}/stashes`),
    onOpenSettings: () => router.push(`/repos/${repoId}/settings`),
    onOpenBlame: () => router.push(`/repos/${repoId}/blame`),
    onOpenHistory: () => router.push(`/repos/${repoId}/history`),
    onOpenCommitted: () => router.push(`/repos/${repoId}/committed`),
    onOpenSearch: () => router.push(`/repos/${repoId}/search`),
    onOpenTags: () => router.push(`/repos/${repoId}/tags`),
    onOpenRemotes: () => router.push(`/repos/${repoId}/remotes`),
    onOpenPatches: () => router.push(`/repos/${repoId}/patches`),
    onOpenShelves: () => router.push(`/repos/${repoId}/shelves`),
    onOpenConsole: () => router.push(`/repos/${repoId}/console`),
    onOpenIgnore: () => router.push(`/repos/${repoId}/ignore`),
    onOpenGithub: () => router.push(`/repos/${repoId}/github`),
    githubAvailable: githubStatus?.detected === true,
    onOpenGitlab: () => router.push(`/repos/${repoId}/gitlab`),
    gitlabAvailable: gitlabStatus?.detected === true,
    onOpenWorktrees: () => router.push(`/repos/${repoId}/worktrees`),
    onOpenSubmodules: () => router.push(`/repos/${repoId}/submodules`),
  };
}
