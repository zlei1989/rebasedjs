/** browse.ts 测试：useBrowseTree/useBrowseContent 查询串与条件拉取（空 rev/file 挂 null key 不发请求） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowseContent, BrowseTree } from '@rebased/contracts';
import { useBrowseContent, useBrowseTree } from './browse';
import { freshCache } from './testing/fresh-cache';

const TREE: BrowseTree = {
  rev: 'aaaaaa',
  entries: [{ mode: '100644', type: 'blob', hash: 'h1', path: 'src/a.ts' }],
};
const CONTENT: BrowseContent = { content: 'hello', binary: false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBrowseTree', () => {
  it('按 rev 拼接查询串请求 browse 端点并返回 BrowseTree', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TREE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BrowseTree; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBrowseTree('r-browse-1', 'aaaaaa');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(TREE));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-browse-1/browse?rev=aaaaaa');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('rev 为空串时挂 null key：不发请求，data 为 undefined', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TREE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BrowseTree; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBrowseTree('r-browse-2', '');
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

describe('useBrowseContent', () => {
  it('按 rev 与 file 拼接查询串请求 content 端点并返回 BrowseContent', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CONTENT), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BrowseContent; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBrowseContent('r-browse-3', 'aaaaaa', 'src/a.ts');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(CONTENT));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-browse-3/browse/content?rev=aaaaaa&file=src%2Fa.ts');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('file 为空串时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CONTENT), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BrowseContent; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBrowseContent('r-browse-4', 'aaaaaa', '');
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
