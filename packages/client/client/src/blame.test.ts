/** blame.ts 测试：useBlame 查询串（BlameLine[]）+ 空 file 挂 null key 不发请求 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlameLine } from '@rebased/contracts';
import { useBlame } from './blame';
import { freshCache } from './testing/fresh-cache';

const LINES: BlameLine[] = [
  { lineno: 1, hash: 'aaaaaa', shortHash: 'aaaaaa', author: 'Ann', authorEmail: 'ann@ex.com', dateIso: '2024-01-01T00:00:00Z', content: 'line 1', previousLineno: null },
  { lineno: 2, hash: 'bbbbbb', shortHash: 'bbbbbb', author: 'Bob', authorEmail: 'bob@ex.com', dateIso: '2024-01-02T00:00:00Z', content: 'line 2', previousLineno: 1 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBlame', () => {
  it('按 file 拼接查询串请求 blame 端点并返回 BlameLine[]', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LINES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BlameLine[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBlame('r-blame-1', 'src/a.txt');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(LINES));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-blame-1/blame?file=src%2Fa.txt');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('file 为空串时挂 null key：不发请求，data 为 undefined（页面可无条件挂载）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LINES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BlameLine[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBlame('r-blame-2', '');
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
