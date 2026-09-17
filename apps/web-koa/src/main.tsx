/**
 * SPA 入口：antd 主题 Provider + BrowserRouter 路由装配。
 * 纯 client 组件（SPA 无 SSR，等价 web-next 容器的 'use client'）；
 * 页面容器与 web-next 同构（同一套 @rebased/ui 页面 + @rebased/client hooks），路由用 react-router。
 * 主题与应用设置同源：useResolvedTheme 读 GET /api/settings 的偏好（auto 跟随系统），
 * 故设置页切主题后在 koa 侧同样全站生效（此前为固定暗色）。
 */
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import { useSettings } from '@rebased/client';
import { DensityProvider, useResolvedTheme } from '@rebased/ui';
import './index.css';
import { ReposPage } from './pages';
import { AppSettingsPage } from './pages/app-settings';
import { RepoBlamePage } from './pages/blame';
import { RepoBranchesPage } from './pages/branches';
import { RepoCommittedPage } from './pages/committed';
import { RepoConflictsPage } from './pages/conflicts';
import { RepoConsolePage } from './pages/console';
import { RepoGithubPage } from './pages/github';
import { RepoGitlabPage } from './pages/gitlab';
import { RepoHistoryPage } from './pages/history';
import { RepoIgnorePage } from './pages/ignore';
import { RepoMergePage } from './pages/merge';
import { RepoPatchesPage } from './pages/patches';
import { RepoPage } from './pages/repo';
import { RepoRemotesPage } from './pages/remotes';
import { RepoDiffPage } from './pages/diff';
import { RepoSearchPage } from './pages/search';
import { RepoSettingsPage } from './pages/settings';
import { RepoShelvesPage } from './pages/shelves';
import { RepoStashesPage } from './pages/stashes';
import { RepoStatusPage } from './pages/status';
import { RepoSubmodulesPage } from './pages/submodules';
import { RepoTagsPage } from './pages/tags';
import { RepoWorktreesPage } from './pages/worktrees';

/** 主题 Provider：偏好来自 GET /api/settings（与设置页同一 SWR 键），未就绪按暗色兜底（与 web-next 首帧口径一致） */
function ThemedApp({ children }: { children: React.ReactNode }): React.ReactNode {
  const { settings } = useSettings();
  const { mode, themeConfig } = useResolvedTheme({ preference: settings?.theme });
  return (
    <ConfigProvider theme={themeConfig}>
      {/* mode 传给 ui 包的 PageShell：其紧凑密度主题需据此选底色算法（auto 已在 hook 内解析为实际明暗） */}
      <DensityProvider mode={mode}>
        {/* holderRender 已由 useResolvedTheme 注册到 ConfigProvider.config：静态 message/Modal 也跟随同一主题 */}
        <AntApp>{children}</AntApp>
      </DensityProvider>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemedApp>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ReposPage />} />
        <Route path="/settings" element={<AppSettingsPage />} />
        <Route path="/repos/:repoId" element={<RepoPage />} />
        <Route path="/repos/:repoId/blame" element={<RepoBlamePage />} />
        <Route path="/repos/:repoId/branches" element={<RepoBranchesPage />} />
        <Route path="/repos/:repoId/committed" element={<RepoCommittedPage />} />
        <Route path="/repos/:repoId/history" element={<RepoHistoryPage />} />
        <Route path="/repos/:repoId/search" element={<RepoSearchPage />} />
        <Route path="/repos/:repoId/merge" element={<RepoMergePage />} />
        <Route path="/repos/:repoId/remotes" element={<RepoRemotesPage />} />
        <Route path="/repos/:repoId/conflicts" element={<RepoConflictsPage />} />
        <Route path="/repos/:repoId/diff" element={<RepoDiffPage />} />
        <Route path="/repos/:repoId/settings" element={<RepoSettingsPage />} />
        <Route path="/repos/:repoId/stashes" element={<RepoStashesPage />} />
        <Route path="/repos/:repoId/status" element={<RepoStatusPage />} />
        <Route path="/repos/:repoId/tags" element={<RepoTagsPage />} />
        <Route path="/repos/:repoId/patches" element={<RepoPatchesPage />} />
        <Route path="/repos/:repoId/shelves" element={<RepoShelvesPage />} />
        <Route path="/repos/:repoId/console" element={<RepoConsolePage />} />
        <Route path="/repos/:repoId/ignore" element={<RepoIgnorePage />} />
        <Route path="/repos/:repoId/github" element={<RepoGithubPage />} />
        <Route path="/repos/:repoId/gitlab" element={<RepoGitlabPage />} />
        <Route path="/repos/:repoId/worktrees" element={<RepoWorktreesPage />} />
        <Route path="/repos/:repoId/submodules" element={<RepoSubmodulesPage />} />
      </Routes>
    </BrowserRouter>
  </ThemedApp>,
);
