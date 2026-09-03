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
import { RepoPage } from './pages/repo';
import { RepoDiffPage } from './pages/diff';
import { RepoSettingsPage } from './pages/settings';
import { RepoStatusPage } from './pages/status';

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <AntApp>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ReposPage />} />
          <Route path="/repos/:repoId" element={<RepoPage />} />
          <Route path="/repos/:repoId/diff" element={<RepoDiffPage />} />
          <Route path="/repos/:repoId/settings" element={<RepoSettingsPage />} />
          <Route path="/repos/:repoId/status" element={<RepoStatusPage />} />
        </Routes>
      </BrowserRouter>
    </AntApp>
  </ConfigProvider>,
);
