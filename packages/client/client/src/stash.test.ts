/** stash.ts 测试：useStashes 查询 + useStashAction 突变（POST 同路径并以响应显式回写 stashes 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StashAction, StashList } from '@rebased/contracts';
import { useStashAction, useStashes } from './stash';
import { freshCache } from './testing/fresh-cache';

const LIST_A: StashList = {
  stashes: [
    {
      index: 0,
      hash: 'a'.repeat(40),
      message: 'wip: first',
      dateIso: '2026-01-01T00:00:00.000Z',
    },
  ],
};
const LIST_B: StashList = {
  stashes: [
    {
      index: 0,
      hash: 'b'.repeat(40),
      message: 'wip: second',
      dateIso: '2026-01-02T00:00:00.000Z',
    },
    ...LIST_A.stashes.map((s) => ({ ...s, index: s.index + 1 })),
  ],
};
const SAVE_ACTION: StashAction = { action: 'save', message: 'wip: second', includeUntracked: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useStashes', () => {
  it('以 /api/repos/:repoId/stashes 为键发起 GET 并返回贮藏列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: StashList | undefined;
    function Probe() {
      data = useStashes('r-st-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-st-1/stashes');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useStashAction', () => {
  it('trigger 发起 POST stashes 并以响应回写 useStashes 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: StashList;
      trigger?: (action: StashAction) => Promise<StashList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useStashes('r-st-2');
      const { trigger, isMutating } = useStashAction('r-st-2');
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

    let updated: StashList | undefined;
    await act(async () => {
      updated = await result.trigger!(SAVE_ACTION);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-st-2/stashes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAVE_ACTION),
    });
    // 响应值显式回写 stashes 缓存键（revalidate:false，不触发二次 GET）
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
