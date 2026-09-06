/** shelf.ts 测试：useShelves 查询 + useShelfAction 突变（POST 同路径并以响应显式回写 shelves 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShelfAction, ShelfList } from '@rebased/contracts';
import { useShelfAction, useShelves } from './shelf';
import { freshCache } from './testing/fresh-cache';

const LIST_A: ShelfList = {
  shelves: [{ name: 'wip', createdAtIso: '2026-01-01T00:00:00.000Z', untrackedCount: 2 }],
};
const LIST_B: ShelfList = {
  shelves: [
    { name: 'feature-branch', createdAtIso: '2026-01-02T00:00:00.000Z', untrackedCount: 1 },
    ...LIST_A.shelves,
  ],
};
const SAVE_ACTION: ShelfAction = { action: 'save', name: 'feature-branch' };
const RESTORE_ACTION: ShelfAction = { action: 'restore', name: 'wip' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useShelves', () => {
  it('以 /api/repos/:repoId/shelves 为键发起 GET 并返回搁置列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ShelfList | undefined;
    function Probe() {
      data = useShelves('r-sh-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-sh-1/shelves');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useShelfAction', () => {
  it('trigger 发起 POST shelves 并以响应回写 useShelves 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: ShelfList;
      trigger?: (action: ShelfAction) => Promise<ShelfList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useShelves('r-sh-2');
      const { trigger, isMutating } = useShelfAction('r-sh-2');
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

    let updated: ShelfList | undefined;
    await act(async () => {
      updated = await result.trigger!(SAVE_ACTION);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-sh-2/shelves', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAVE_ACTION),
    });
    // 响应值显式回写 shelves 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('restore action：判别联合 body 原样序列化（action:restore + name）', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_A), { status: 200 });
      return new Response(JSON.stringify(LIST_B), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: { trigger?: (action: ShelfAction) => Promise<ShelfList> } = {};
    function Probe() {
      const { trigger } = useShelfAction('r-sh-3');
      result = { trigger };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    await act(async () => {
      await result.trigger!(RESTORE_ACTION);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-sh-3/shelves', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(RESTORE_ACTION),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
