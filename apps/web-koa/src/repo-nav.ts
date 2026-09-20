/**
 * 仓库页共用导航装配（web-koa 容器侧）：useRepoNav(repoId) 一处装配 RepoTopNav 所需的
 * 导航回调全集（仓库名 + 回首页 + 各仓库页路由 + GitHub/GitLab 可用性 + 仓库状态），
 * 各仓库页容器展开注入 `<RepoTopNav {...nav} current="xxx" />`，取代原先每页复制的「返回日志」链接。
 * 仓库名取 useRecentRepos（与日志页同源，缺省回落 repoId）；仓库状态（分支名 + ahead/behind）经
 * useRepoStatus 拉取——所有仓库页的顶栏都显示当前分支名（SWR 同键缓存，页面间切换零重复请求）；
 * GitHub/GitLab 可用性经 useGithubStatus/useGitlabStatus 检测（同样按键缓存）。
 * 拉取/推送/更新项目/变基四个「更多」对话框入口**不在此装配**——对话框状态只在日志页容器持有。
 */
import { useGithubStatus, useGitlabStatus, useRecentRepos, useRepoStatus } from '@rebased/client';
import type { RepoTopNavProps } from '@rebased/ui';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const { data: repos } = useRecentRepos();
  const { data: githubStatus } = useGithubStatus(repoId);
  const { data: gitlabStatus } = useGitlabStatus(repoId);
  // 仓库状态：顶栏分支名 + ahead/behind（与状态页/日志页同键，SWR 缓存共享）
  const { data: status } = useRepoStatus(repoId);
  // react-router v7 navigate 可能返回 Promise：包函数体固定 void 返回
  const go = (path: string): void => {
    void navigate(path);
  };
  return {
    repoName: repos?.find((r) => r.id === repoId)?.name ?? repoId,
    status,
    onGoHome: () => go('/'),
    onOpenLog: () => go(`/repos/${repoId}`),
    onOpenStatus: () => go(`/repos/${repoId}/status`),
    onOpenBranches: () => go(`/repos/${repoId}/branches`),
    onOpenMerge: () => go(`/repos/${repoId}/merge`),
    onOpenStashes: () => go(`/repos/${repoId}/stashes`),
    onOpenSettings: () => go(`/repos/${repoId}/settings`),
    onOpenBlame: () => go(`/repos/${repoId}/blame`),
    onOpenHistory: () => go(`/repos/${repoId}/history`),
    onOpenSearch: () => go(`/repos/${repoId}/search`),
    onOpenTags: () => go(`/repos/${repoId}/tags`),
    onOpenRemotes: () => go(`/repos/${repoId}/remotes`),
    onOpenPatches: () => go(`/repos/${repoId}/patches`),
    onOpenShelves: () => go(`/repos/${repoId}/shelves`),
    onOpenConsole: () => go(`/repos/${repoId}/console`),
    onOpenIgnore: () => go(`/repos/${repoId}/ignore`),
    onOpenGithub: () => go(`/repos/${repoId}/github`),
    githubAvailable: githubStatus?.detected === true,
    onOpenGitlab: () => go(`/repos/${repoId}/gitlab`),
    gitlabAvailable: gitlabStatus?.detected === true,
    onOpenWorktrees: () => go(`/repos/${repoId}/worktrees`),
    onOpenSubmodules: () => go(`/repos/${repoId}/submodules`),
  };
}
