/** merge.ts 测试：useMerge 发起合并 + useContinueMerge 继续合并（POST 无请求体，响应 RepoStatus 回写 status 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MergeBody, MergeOutcome, RepoStatus } from '@rebased/contracts';
import { useContinueMerge, useMerge } from './merge';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const MERGE_BODY: MergeBody = { branch: 'feature', noFf: true };
const OUTCOME: MergeOutcome = { status: 'conflicts', conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] };
const STATUS_BEFORE: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'a'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [{ path: 'a.txt', code: 'UU' }],
};
const STATUS_AFTER: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'b'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMerge', () => {
  it('trigger 发起 POST merge 并返回 MergeOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      trigger?: (body: MergeBody) => Promise<MergeOutcome>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { trigger, isMutating } = useMerge('r-m-1');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: MergeOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(MERGE_BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-m-1/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(MERGE_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useContinueMerge', () => {
  it('trigger 发起 POST merge/continue 并以响应回写 useRepoStatus 缓存', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(STATUS_AFTER), { status: 200 });
      return new Response(JSON.stringify(STATUS_BEFORE), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RepoStatus;
      trigger?: () => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-m-2');
      const { trigger, isMutating } = useContinueMerge('r-m-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(STATUS_BEFORE));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let status: RepoStatus | undefined;
    await act(async () => {
      status = await result.trigger!();
    });

    expect(status).toEqual(STATUS_AFTER);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-m-2/merge/continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    // 响应值显式回写 status 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(STATUS_AFTER));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
