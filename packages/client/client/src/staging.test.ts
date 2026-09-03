/** staging.ts 测试：useStaging/useHunkStaging 突变（POST 并以响应显式回写 status 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HunkStagingBody, RepoStatus, StagingBody } from '@rebased/contracts';
import { useRepoStatus } from './repos';
import { useHunkStaging, useStaging } from './staging';
import { freshCache } from './testing/fresh-cache';

const UNSTAGED: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'a'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [{ path: 'a.ts', code: ' M' }],
};
const STAGED: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'a'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [{ path: 'a.ts', code: 'M ' }],
};
const STAGE_BODY: StagingBody = { action: 'stage', paths: ['a.ts'] };
const HUNK_BODY: HunkStagingBody = { action: 'stage', file: 'a.ts', hunks: [0, 2] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useStaging', () => {
  it('trigger 发起 POST staging 并以响应回写 useRepoStatus 缓存；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(STAGED), { status: 200 });
      return new Response(JSON.stringify(UNSTAGED), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RepoStatus;
      trigger?: (body: StagingBody) => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-stg-1');
      const { trigger, isMutating } = useStaging('r-stg-1');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(UNSTAGED));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let staged: RepoStatus | undefined;
    await act(async () => {
      staged = await result.trigger!(STAGE_BODY);
    });

    expect(staged).toEqual(STAGED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-stg-1/staging', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(STAGE_BODY),
    });
    // 响应值显式回写 status 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(STAGED));
    });
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useHunkStaging', () => {
  it('trigger 发起 POST staging/hunks 并以响应回写 useRepoStatus 缓存', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(STAGED), { status: 200 });
      return new Response(JSON.stringify(UNSTAGED), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RepoStatus;
      trigger?: (body: HunkStagingBody) => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-stg-2');
      const { trigger, isMutating } = useHunkStaging('r-stg-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(UNSTAGED));
    });

    let staged: RepoStatus | undefined;
    await act(async () => {
      staged = await result.trigger!(HUNK_BODY);
    });

    expect(staged).toEqual(STAGED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-stg-2/staging/hunks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(HUNK_BODY),
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(STAGED));
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
