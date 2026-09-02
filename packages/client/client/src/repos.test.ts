/** repos.ts 测试：useRecentRepos 拉取列表 + useOpenRepo 突变（POST 体与返回 repoId） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoInfo, RepoStatus } from '@rebased/contracts';
import { useOpenRepo, useRecentRepos, useRepoStatus } from './repos';

const REPO: RepoInfo = { id: 'r1', path: '/tmp/repo', name: 'repo', openedAt: '2026-09-01T00:00:00Z' };
const STATUS: RepoStatus = { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, entries: [{ path: 'a.ts', code: ' M' }] };

function freshCache(children: React.ReactNode) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRecentRepos', () => {
  it('GET /api/repos 返回最近仓库列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([REPO]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: RepoInfo[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useRecentRepos();
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual([REPO]));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useRepoStatus', () => {
  it('GET /api/repos/:repoId/status 返回工作区状态', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(STATUS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: RepoStatus; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useRepoStatus('r-status-1');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(STATUS));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-status-1/status');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useOpenRepo', () => {
  it('trigger 发起 POST /api/repos/open 并返回 {repoId}；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ repoId: 'r9' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let triggerFn!: (arg: { path: string }) => Promise<{ repoId: string }>;
    function Probe() {
      const { trigger, isMutating } = useOpenRepo();
      void isMutating;
      triggerFn = trigger;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    let opened: { repoId: string } | undefined;
    await act(async () => {
      opened = await triggerFn({ path: '/tmp/repo' });
    });

    expect(opened).toEqual({ repoId: 'r9' });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/repo' }),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
