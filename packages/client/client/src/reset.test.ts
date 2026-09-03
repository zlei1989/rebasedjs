/** reset.ts 测试：useReset/useUndoCommit 突变（POST 并以响应显式回写 status 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoStatus, ResetBody } from '@rebased/contracts';
import { useRepoStatus } from './repos';
import { useReset, useUndoCommit } from './reset';
import { freshCache } from './testing/fresh-cache';

const DIRTY: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'a'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [{ path: 'a.ts', code: ' M' }],
};
const CLEAN: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'b'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [],
};
const RESET_BODY: ResetBody = { ref: 'HEAD~1', mode: 'hard' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReset', () => {
  it('trigger 发起 POST reset（携带 ResetBody）并以响应回写 useRepoStatus 缓存；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(CLEAN), { status: 200 });
      return new Response(JSON.stringify(DIRTY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RepoStatus;
      trigger?: (body: ResetBody) => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-reset-1');
      const { trigger, isMutating } = useReset('r-reset-1');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(DIRTY));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let status: RepoStatus | undefined;
    await act(async () => {
      status = await result.trigger!(RESET_BODY);
    });

    expect(status).toEqual(CLEAN);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-reset-1/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(RESET_BODY),
    });
    // 响应值显式回写 status 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(CLEAN));
    });
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useUndoCommit', () => {
  it('trigger 发起 POST reset/undo-commit（空体 {}）并以响应回写 useRepoStatus 缓存', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(CLEAN), { status: 200 });
      return new Response(JSON.stringify(DIRTY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RepoStatus;
      trigger?: () => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-reset-2');
      const { trigger, isMutating } = useUndoCommit('r-reset-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(DIRTY));
    });

    let status: RepoStatus | undefined;
    await act(async () => {
      status = await result.trigger!();
    });

    expect(status).toEqual(CLEAN);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-reset-2/reset/undo-commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(CLEAN));
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
