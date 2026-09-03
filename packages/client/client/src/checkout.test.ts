/** checkout.ts 测试：useCheckout 突变（POST checkout，响应 RepoStatus 显式回写 status 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutAction, RepoStatus } from '@rebased/contracts';
import { useCheckout } from './checkout';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const ON_MAIN: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'a'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [],
};
const ON_FEATURE: RepoStatus = {
  ...ON_MAIN,
  branch: 'feature',
  headHash: 'b'.repeat(40),
};
const CHECKOUT_BODY: CheckoutAction = { action: 'branch', name: 'feature' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCheckout', () => {
  it('trigger 发起 POST checkout 并以响应回写 useRepoStatus 缓存；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(ON_FEATURE), { status: 200 });
      return new Response(JSON.stringify(ON_MAIN), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RepoStatus;
      trigger?: (action: CheckoutAction) => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-ck-1');
      const { trigger, isMutating } = useCheckout('r-ck-1');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(ON_MAIN));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let checkedOut: RepoStatus | undefined;
    await act(async () => {
      checkedOut = await result.trigger!(CHECKOUT_BODY);
    });

    expect(checkedOut).toEqual(ON_FEATURE);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-ck-1/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CHECKOUT_BODY),
    });
    // 响应值显式回写 status 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(ON_FEATURE));
    });
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
