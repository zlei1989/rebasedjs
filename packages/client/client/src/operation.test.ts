/** operation.ts 测试：useOperation 拉取 + useAbortOperation 突变（POST 空体并以响应回写 useOperation 缓存） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationState } from '@rebased/contracts';
import { useAbortOperation, useOperation } from './operation';

const RUNNING: OperationState = { kind: 'rebase', step: 2, total: 5 };
const IDLE: OperationState = { kind: 'none' };

function freshCache(children: React.ReactNode) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}

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
