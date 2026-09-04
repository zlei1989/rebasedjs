/** remote.ts 测试：useRemotes 查询 + useRemoteAction 突变（POST 同路径并以响应显式回写 remotes 缓存键）
 *  + useFetch/usePull/usePush 即发即弃突变（各自端点键，无回写） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult, PullBody, PullOutcome, PushBody, PushOutcome, RemoteAction, RemoteList } from '@rebased/contracts';
import { useFetch, usePull, usePush, useRemoteAction, useRemotes } from './remote';
import { freshCache } from './testing/fresh-cache';

const LIST_A: RemoteList = {
  remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' }],
};
const LIST_B: RemoteList = {
  remotes: [
    ...LIST_A.remotes,
    { name: 'upstream', fetchUrl: 'https://example.com/up.git', pushUrl: 'https://example.com/up.git' },
  ],
};
const ADD_ACTION: RemoteAction = { action: 'add', name: 'upstream', url: 'https://example.com/up.git' };
const FETCH_RESULT: FetchResult = { updatedRefs: ['refs/remotes/origin/main'] };
const PULL_OUTCOME: PullOutcome = { status: 'updated' };
const PUSH_OUTCOME: PushOutcome = { status: 'pushed' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRemotes', () => {
  it('以 /api/repos/:repoId/remotes 为键发起 GET 并返回远程列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: RemoteList | undefined;
    function Probe() {
      data = useRemotes('r-rm-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rm-1/remotes');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useRemoteAction', () => {
  it('trigger 发起 POST remotes 并以响应回写 useRemotes 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: RemoteList;
      trigger?: (action: RemoteAction) => Promise<RemoteList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRemotes('r-rm-2');
      const { trigger, isMutating } = useRemoteAction('r-rm-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let updated: RemoteList | undefined;
    await act(async () => {
      updated = await result.trigger!(ADD_ACTION);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rm-2/remotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADD_ACTION),
    });
    // 响应值显式回写 remotes 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useFetch', () => {
  it('trigger 无参时 POST 空体 fetch 并返回 FetchResult；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FETCH_RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { trigger?: (body?: { remote?: string }) => Promise<FetchResult>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useFetch('r-rm-3');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isMutating).toBe(false);

    let fetched: FetchResult | undefined;
    await act(async () => {
      fetched = await result.trigger!();
    });

    expect(fetched).toEqual(FETCH_RESULT);
    expect(result.isMutating).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rm-3/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('trigger 携带 remote 时 POST 对应请求体', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FETCH_RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let trigger: ((body?: { remote?: string }) => Promise<FetchResult>) | undefined;
    function Probe() {
      trigger = useFetch('r-rm-4').trigger;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await trigger!({ remote: 'origin' });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rm-4/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remote: 'origin' }),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('usePull', () => {
  it('trigger 发起 POST pull 并返回 PullOutcome；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PULL_OUTCOME), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body: PullBody = { remote: 'origin', rebase: true };

    let result: { trigger?: (body?: PullBody) => Promise<PullOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = usePull('r-rm-5');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    let outcome: PullOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(body);
    });

    expect(outcome).toEqual(PULL_OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rm-5/pull', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('usePush', () => {
  it('trigger 发起 POST push 并返回 PushOutcome；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PUSH_OUTCOME), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body: PushBody = { branch: 'main', forceWithLease: true, setUpstream: true };

    let result: { trigger?: (body?: PushBody) => Promise<PushOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = usePush('r-rm-6');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    let outcome: PushOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(body);
    });

    expect(outcome).toEqual(PUSH_OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rm-6/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
