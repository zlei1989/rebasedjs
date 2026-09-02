/** diff.ts 测试：useFileDiff 查询串 + useDiffStream 分块累积/断开清理（mock subscribeSse） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffFile, SseEvent } from '@rebased/contracts';
import { subscribeSse } from './events';
import { useDiffStream, useFileDiff } from './diff';

vi.mock('./events', () => ({ subscribeSse: vi.fn() }));

const subscribeMock = vi.mocked(subscribeSse);

afterEach(() => {
  vi.unstubAllGlobals();
  subscribeMock.mockReset();
});

describe('useFileDiff', () => {
  it('按 file/staged 拼接查询串请求 diff 端点并返回 DiffFile', async () => {
    const diff: DiffFile = { path: 'a.ts', text: '@@ -1 +1 @@\n-old\n+new' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(diff), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // 渲染期间访问属性以登记 SWR 依赖
    let result: { data?: DiffFile; error?: unknown; isLoading: boolean } | undefined;
    function Probe() {
      const { data, error, isLoading } = useFileDiff('r-diff-1', 'a.ts', true);
      result = { data, error, isLoading };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(diff));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-diff-1/diff?file=a.ts&staged=true');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useDiffStream', () => {
  it('diff.chunk 事件累积拼接 text，卸载时中止订阅', async () => {
    let captured!: { onEvent: (event: SseEvent) => void; signal?: AbortSignal };
    subscribeMock.mockImplementation(async (_url, onEvent, signal) => {
      captured = { onEvent, signal };
      await new Promise(() => {}); // 长连接：永不 resolve
    });

    let result!: ReturnType<typeof useDiffStream>;
    function Probe() {
      result = useDiffStream('r-diff-2', 'b.ts');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });

    expect(subscribeMock).toHaveBeenCalledWith('/api/repos/r-diff-2/diff/stream?file=b.ts', expect.any(Function), expect.any(AbortSignal));
    expect(result.connected).toBe(true);
    expect(result.text).toBe('');

    await act(async () => {
      captured.onEvent({ type: 'diff.chunk', payload: { text: '@@ -1' } });
    });
    expect(result.text).toBe('@@ -1');

    await act(async () => {
      captured.onEvent({ type: 'diff.chunk', payload: { text: ' +1 @@' } });
    });
    expect(result.text).toBe('@@ -1 +1 @@');

    await act(async () => {
      captured.onEvent({ type: 'log.line', payload: { hash: 'x' } });
    });
    expect(result.text).toBe('@@ -1 +1 @@');

    await act(async () => {
      renderer.unmount();
    });
    expect(captured.signal?.aborted).toBe(true);
  });
});
