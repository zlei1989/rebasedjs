/** search.ts 测试：useSearch 查询串（SearchResult[]，grep/pickaxe 模式）+ 空 q 挂 null key 不发请求 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '@rebased/contracts';
import { useSearch } from './search';
import { freshCache } from './testing/fresh-cache';

const HITS: SearchResult[] = [
  { hash: 'dddddd', shortHash: 'dddddd', subject: 'fix bug in parser', author: 'Dan', dateIso: '2024-01-04T00:00:00Z' },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSearch', () => {
  it('grep 模式：按 q/mode 拼接查询串请求 search 端点并返回 SearchResult[]', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(HITS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: SearchResult[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useSearch('r-search-1', 'fix bug', 'grep');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(HITS));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-search-1/search?q=fix+bug&mode=grep');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('pickaxe 模式：mode 拼接为 pickaxe', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(HITS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: SearchResult[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useSearch('r-search-2', 'TODO', 'pickaxe');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(HITS));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-search-2/search?q=TODO&mode=pickaxe');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('q 为空串时挂 null key：不发请求，data 为 undefined（输入清空不误发）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(HITS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: SearchResult[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useSearch('r-search-3', '', 'grep');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    expect(result?.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});
