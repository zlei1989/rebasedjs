/** changelist.ts 测试：useChangelists 查询 + useChangelistAction 突变（POST 同路径并以响应显式回写 changelists 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangelistAction, ChangelistView } from '@rebased/contracts';
import { useChangelistAction, useChangelists } from './changelist';
import { freshCache } from './testing/fresh-cache';

const VIEW_A: ChangelistView = {
  lists: [{ id: 'default', name: '默认', isDefault: true }],
  assignments: { 'a.txt': 'default' },
};
const VIEW_B: ChangelistView = {
  lists: [
    { id: 'default', name: '默认', isDefault: true },
    { id: 'cl-1', name: '功能A', isDefault: false },
  ],
  assignments: { 'a.txt': 'cl-1' },
};
const CREATE_ACTION: ChangelistAction = { action: 'create', name: '功能A' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChangelists', () => {
  it('以 /api/repos/:repoId/changelists 为键发起 GET 并返回变更列表视图', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(VIEW_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ChangelistView | undefined;
    function Probe() {
      data = useChangelists('r-cl-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(VIEW_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cl-1/changelists');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useChangelistAction', () => {
  it('trigger 发起 POST changelists 并以响应回写 useChangelists 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(VIEW_B), { status: 200 });
      return new Response(JSON.stringify(VIEW_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: ChangelistView;
      trigger?: (action: ChangelistAction) => Promise<ChangelistView>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useChangelists('r-cl-2');
      const { trigger, isMutating } = useChangelistAction('r-cl-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(VIEW_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let updated: ChangelistView | undefined;
    await act(async () => {
      updated = await result.trigger!(CREATE_ACTION);
    });

    expect(updated).toEqual(VIEW_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cl-2/changelists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREATE_ACTION),
    });
    // 响应值显式回写 changelists 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(VIEW_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
