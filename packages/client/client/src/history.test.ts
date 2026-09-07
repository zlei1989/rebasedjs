/** history.ts 测试：useHistory 查询串（FileHistoryEntry[]）+ 空 file 挂 null key 不发请求 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileHistoryEntry } from '@rebased/contracts';
import { useHistory } from './history';
import { freshCache } from './testing/fresh-cache';

const ENTRIES: FileHistoryEntry[] = [
  { hash: 'bbbbbb', shortHash: 'bbbbbb', subject: 'rename + edit', author: 'Bob', dateIso: '2024-01-02T00:00:00Z', parents: ['aaaaaa'] },
  { hash: 'aaaaaa', shortHash: 'aaaaaa', subject: 'add file', author: 'Ann', dateIso: '2024-01-01T00:00:00Z', parents: [] },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useHistory', () => {
  it('按 file 拼接查询串请求 history 端点并返回 FileHistoryEntry[]', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENTRIES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: FileHistoryEntry[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useHistory('r-history-1', 'b.txt');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(ENTRIES));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-history-1/history?file=b.txt');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('file 为空串时挂 null key：不发请求，data 为 undefined', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENTRIES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: FileHistoryEntry[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useHistory('r-history-2', '');
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
