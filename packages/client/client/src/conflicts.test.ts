/** conflicts.ts 测试：useConflicts/useConflictContents 查询（空 path 不发请求）+ useResolveConflict 突变（响应回写 conflicts 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConflictContents, ConflictList, ResolveConflictBody } from '@rebased/contracts';
import { useConflictContents, useConflicts, useResolveConflict } from './conflicts';
import { freshCache } from './testing/fresh-cache';

const LIST_A: ConflictList = { conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] };
const LIST_B: ConflictList = { conflicts: [] };
const CONTENTS: ConflictContents = { path: 'a.txt', base: 'base', ours: 'ours', theirs: 'theirs' };
const RESOLVE_BODY: ResolveConflictBody = { strategy: 'theirs', path: 'a.txt' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useConflicts', () => {
  it('以 /api/repos/:repoId/conflicts 为键发起 GET 并返回冲突列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ConflictList | undefined;
    function Probe() {
      data = useConflicts('r-c-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-c-1/conflicts');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useConflictContents', () => {
  it('以 …/conflicts/contents?path= 为键发起 GET 并返回三版本内容', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CONTENTS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ConflictContents | undefined;
    function Probe() {
      data = useConflictContents('r-c-2', 'a.txt').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(CONTENTS));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-c-2/conflicts/contents?path=a.txt');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('path 为空串时挂 null key，不发起请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CONTENTS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ConflictContents | undefined;
    function Probe() {
      data = useConflictContents('r-c-3', '').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    expect(data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useResolveConflict', () => {
  it('trigger 发起 POST conflicts/resolve 并以响应回写 useConflicts 缓存；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: ConflictList;
      trigger?: (body: ResolveConflictBody) => Promise<ConflictList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useConflicts('r-c-4');
      const { trigger, isMutating } = useResolveConflict('r-c-4');
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

    let updated: ConflictList | undefined;
    await act(async () => {
      updated = await result.trigger!(RESOLVE_BODY);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-c-4/conflicts/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(RESOLVE_BODY),
    });
    // 响应值显式回写 conflicts 缓存键（revalidate:false，不触发二次 GET——mutation 键与查询键同键的 P2-C 教训）
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
