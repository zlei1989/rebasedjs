/** console.ts 测试：useConsole 查询（limit 查询串，缺省不带参走服务端默认） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleEntry } from '@rebased/contracts';
import { useConsole } from './console';
import { freshCache } from './testing/fresh-cache';

const ENTRIES: ConsoleEntry[] = [
  {
    id: 1,
    args: ['git', 'status', '--porcelain=v2'],
    exitCode: 0,
    durationMs: 12,
    stderrTail: '',
    atIso: '2026-01-01T00:00:00.000Z',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useConsole', () => {
  it('limit 有值时以 ?limit= 查询串请求 console 端点并返回 ConsoleEntry[]', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENTRIES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ConsoleEntry[] | undefined;
    function Probe() {
      data = useConsole('r-con-1', 200).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(ENTRIES));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-con-1/console?limit=200');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('limit 缺省时不带查询串（服务端默认 100）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENTRIES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: ConsoleEntry[] | undefined;
    function Probe() {
      data = useConsole('r-con-2').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(ENTRIES));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-con-2/console');
    await act(async () => {
      renderer.unmount();
    });
  });
});
