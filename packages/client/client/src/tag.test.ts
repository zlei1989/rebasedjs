/** tag.ts 测试：useTags 查询 + useTagAction 突变（POST 同路径并以响应显式回写 tags 缓存键，即同键纪律） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TagAction, TagList } from '@rebased/contracts';
import { useTagAction, useTags } from './tag';
import { freshCache } from './testing/fresh-cache';

const LIST_A: TagList = {
  tags: [{ name: 'v1.0.0', hash: 'a'.repeat(40), subject: null, annotated: false }],
};
const LIST_B: TagList = {
  tags: [
    { name: 'v1.1.0', hash: 'b'.repeat(40), subject: 'release 1.1', annotated: true },
    ...LIST_A.tags,
  ],
};
const CREATE_ACTION: TagAction = { action: 'create', name: 'v1.1.0', ref: 'main', message: 'release 1.1' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTags', () => {
  it('以 /api/repos/:repoId/tags 为键发起 GET 并返回标签列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: TagList | undefined;
    function Probe() {
      data = useTags('r-tg-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-tg-1/tags');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useTagAction', () => {
  it('trigger 发起 POST tags 并以响应回写 useTags 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: TagList;
      trigger?: (action: TagAction) => Promise<TagList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useTags('r-tg-2');
      const { trigger, isMutating } = useTagAction('r-tg-2');
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

    let updated: TagList | undefined;
    await act(async () => {
      updated = await result.trigger!(CREATE_ACTION);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-tg-2/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREATE_ACTION),
    });
    // 响应值显式回写 tags 缓存键（revalidate:false，不触发二次 GET）
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
