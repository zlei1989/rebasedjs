/**
 * SPA 入口：antd 暗色主题 Provider + BrowserRouter 路由装配。
 * 纯 client 组件（SPA 无 SSR，等价 web-next 容器的 'use client'）；
 * 页面容器与 web-next 同构（同一套 @rebased/ui 页面 + @rebased/client hooks），路由用 react-router。
 */
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import './index.css';
import { ReposPage } from './pages';
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

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <AntApp>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ReposPage />} />
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
    </AntApp>
  </ConfigProvider>,
);
