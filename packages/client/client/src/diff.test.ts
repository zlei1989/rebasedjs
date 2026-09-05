/** diff.ts 测试：useFileDiff/useDiffPatch 查询串（FileVersions/DiffFile，patch 空 file 走 null key）+ useDiffStream 分块累积/stream.error/断开清理（mock subscribeSse） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffFile, FileVersions, SseEvent } from '@rebased/contracts';
import { subscribeSse } from './events';
import { useDiffPatch, useDiffStream, useFileDiff } from './diff';
import { freshCache } from './testing/fresh-cache';

vi.mock('./events', () => ({ subscribeSse: vi.fn() }));

const subscribeMock = vi.mocked(subscribeSse);

afterEach(() => {
  vi.unstubAllGlobals();
  subscribeMock.mockReset();
});

describe('useFileDiff', () => {
  it('按 file/staged 拼接查询串请求 diff 端点并返回 FileVersions', async () => {
    const versions: FileVersions = { before: 'old', after: 'new' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(versions), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // 渲染期间访问属性以登记 SWR 依赖
    let result: { data?: FileVersions; error?: unknown; isLoading: boolean } | undefined;
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
      await vi.waitFor(() => expect(result?.data).toEqual(versions));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-diff-1/diff?file=a.ts&staged=true');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('传入 from/to 时查询串携带两参（committed 打开定提交对比：from=<hash>~1、to=<hash>）', async () => {
    const versions: FileVersions = { before: 'old', after: 'new' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(versions), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: FileVersions; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useFileDiff('r-diff-6', 'a.ts', false, 'abc1234~1', 'abc1234');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(versions));
    });

    // URLSearchParams 将 ~ 百分号编码为 %7E（服务端解码还原），断言按序列化结果
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-diff-6/diff?file=a.ts&staged=false&from=abc1234%7E1&to=abc1234');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useDiffPatch', () => {
  it('按 file/staged 拼接查询串请求 diff/patch 端点并返回 DiffFile', async () => {
    const patch: DiffFile = { path: 'a.ts', text: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(patch), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: DiffFile; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useDiffPatch('r-diff-4', 'a.ts', false);
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(patch));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-diff-4/diff/patch?file=a.ts&staged=false');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('file 为空串时挂 null key：不发请求，data 为 undefined（页面可无条件挂载）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: DiffFile; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useDiffPatch('r-diff-5', '', true);
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

  it('stream.error 帧：错误消息存入 error 并断开连接（中止订阅）', async () => {
    let captured!: { onEvent: (event: SseEvent) => void; signal?: AbortSignal };
    subscribeMock.mockImplementation(async (_url, onEvent, signal) => {
      captured = { onEvent, signal };
      await new Promise(() => {}); // 长连接：永不 resolve
    });

    let result!: ReturnType<typeof useDiffStream>;
    function Probe() {
      result = useDiffStream('r-diff-3', 'c.ts');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    expect(result.error).toBeNull();

    await act(async () => {
      captured.onEvent({ type: 'stream.error', payload: { message: 'git diff 失败' } });
    });
    expect(result.error).toBe('git diff 失败');
    expect(result.connected).toBe(false);
    expect(captured.signal?.aborted).toBe(true);

    await act(async () => {
      renderer.unmount();
    });
  });
});
