/** repos.ts 测试：useRecentRepos 拉取列表 + useOpenRepo/useInitRepo/useCloneRepo/useRemoveRepo 突变 + useAppHomeDir 查询 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoInfo, RepoStatus } from '@rebased/contracts';
import { useAppHomeDir, useCloneRepo, useInitRepo, useOpenRepo, useRecentRepos, useRemoveRepo, useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const REPO: RepoInfo = { id: 'r1', path: '/tmp/repo', name: 'repo', openedAt: '2026-09-01T00:00:00Z' };
const STATUS: RepoStatus = { branch: 'main', upstream: 'origin/main', headHash: 'a'.repeat(40), ahead: 1, behind: 2, entries: [{ path: 'a.ts', code: ' M' }] };

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

describe('useInitRepo', () => {
  it('trigger 发起 POST /api/repos/init 并返回 {repoId}', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ repoId: 'r-init' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let triggerFn!: (arg: { path: string }) => Promise<{ repoId: string }>;
    function Probe() {
      const { trigger } = useInitRepo();
      triggerFn = trigger;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    let opened: { repoId: string } | undefined;
    await act(async () => {
      opened = await triggerFn({ path: '/tmp/new' });
    });

    expect(opened).toEqual({ repoId: 'r-init' });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/new' }),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCloneRepo', () => {
  it('trigger 发起 POST /api/repos/clone（url+targetDir）并返回 {repoId}', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ repoId: 'r-clone' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let triggerFn!: (arg: { url: string; targetDir: string }) => Promise<{ repoId: string }>;
    function Probe() {
      const { trigger } = useCloneRepo();
      triggerFn = trigger;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    let opened: { repoId: string } | undefined;
    await act(async () => {
      opened = await triggerFn({ url: 'https://example.com/a/b.git', targetDir: 'D:\\work\\b' });
    });

    expect(opened).toEqual({ repoId: 'r-clone' });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/a/b.git', targetDir: 'D:\\work\\b' }),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useRemoveRepo', () => {
  it('trigger 按 repoId 发起 DELETE /api/repos/:repoId', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let triggerFn!: (repoId: string) => Promise<{ ok: true }>;
    function Probe() {
      const { trigger } = useRemoveRepo();
      triggerFn = trigger;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    let result: { ok: true } | undefined;
    await act(async () => {
      result = await triggerFn('r-remove-1');
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-remove-1', { method: 'DELETE' });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useAppHomeDir', () => {
  it('GET /api/app/home-dir 返回 {homeDir}', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ homeDir: 'C:\\Users\\dev' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: { homeDir: string } } | undefined;
    function Probe() {
      const { data } = useAppHomeDir();
      result = { data };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual({ homeDir: 'C:\\Users\\dev' }));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/app/home-dir');
    await act(async () => {
      renderer.unmount();
    });
  });
});
