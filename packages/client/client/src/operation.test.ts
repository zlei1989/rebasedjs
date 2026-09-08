/** operation.ts 测试：useOperation 拉取 + useAbortOperation/useContinueOperation 突变（POST 空体，响应分别回写 operation/status 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationState, RepoStatus } from '@rebased/contracts';
import { useAbortOperation, useContinueOperation, useOperation, useSkipOperation } from './operation';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const RUNNING: OperationState = { kind: 'rebase', step: 2, total: 5 };
const IDLE: OperationState = { kind: 'none' };
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

describe('useOperation', () => {
  it('GET /api/repos/:repoId/operation 返回进行中操作状态', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RUNNING), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: OperationState; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useOperation('r-op-1');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(RUNNING));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-op-1/operation');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useAbortOperation', () => {
  it('trigger 发起 POST operation/abort（空体 {}）并以响应回写 useOperation 缓存', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(IDLE), { status: 200 });
      return new Response(JSON.stringify(RUNNING), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: OperationState;
      trigger?: () => Promise<OperationState>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useOperation('r-op-2');
      const { trigger, isMutating } = useAbortOperation('r-op-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(RUNNING));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let aborted: OperationState | undefined;
    await act(async () => {
      aborted = await result.trigger!();
    });

    expect(aborted).toEqual(IDLE);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-op-2/operation/abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(IDLE));
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useContinueOperation', () => {
  it('trigger 发起 POST operation/continue（空体 {}）并以响应回写 useRepoStatus 缓存；全程恰好 1 次 GET', async () => {
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
      const { data } = useRepoStatus('r-op-3');
      const { trigger, isMutating } = useContinueOperation('r-op-3');
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
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-op-3/operation/continue', {
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

describe('useSkipOperation', () => {
  it('trigger 发起 POST operation/skip（空体 {}）并以响应回写 useRepoStatus 缓存；全程恰好 1 次 GET', async () => {
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
      const { data } = useRepoStatus('r-op-4');
      const { trigger, isMutating } = useSkipOperation('r-op-4');
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

    let status: RepoStatus | undefined;
    await act(async () => {
      status = await result.trigger!();
    });

    expect(status).toEqual(STATUS_AFTER);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-op-4/operation/skip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
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
