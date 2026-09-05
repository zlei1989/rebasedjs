/** committed.ts 测试：useCommittedPage 查询串（CommittedPage，limit/skip 仅在有值时拼接） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommittedPage } from '@rebased/contracts';
import { useCommittedPage } from './committed';
import { freshCache } from './testing/fresh-cache';

const PAGE: CommittedPage = {
  entries: [
    { hash: 'cccccc', shortHash: 'cccccc', subject: 'extend', author: 'Cara', dateIso: '2024-01-03T00:00:00Z', parents: ['bbbbbb'], files: [{ path: 'a.txt', status: 'M' }] },
  ],
  hasMore: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCommittedPage', () => {
  it('按 limit/skip 拼接查询串请求 committed 端点并返回 CommittedPage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAGE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: CommittedPage; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useCommittedPage('r-committed-1', { limit: 10, skip: 20 });
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(PAGE));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-committed-1/committed?limit=10&skip=20');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('仅 limit 时有值：查询串只含 limit', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAGE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: CommittedPage; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useCommittedPage('r-committed-2', { limit: 5 });
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(PAGE));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-committed-2/committed?limit=5');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('query 省略时请求无查询串的 committed 端点（服务端默认 limit=50/skip=0）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAGE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: CommittedPage; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useCommittedPage('r-committed-3');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(PAGE));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-committed-3/committed');
    await act(async () => {
      renderer.unmount();
    });
  });
});
