/** log.ts 测试：useLogPage 查询串拼接 + useLogStream 增量追加/断开清理（mock subscribeSse） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitInfo, LogPage, SseEvent } from '@rebased/contracts';
import { subscribeSse } from './events';
import { useLogPage, useLogStream } from './log';

vi.mock('./events', () => ({ subscribeSse: vi.fn() }));

const COMMIT_A: CommitInfo = {
  hash: 'aaa', shortHash: 'aaa', parents: [], author: 'Ann', authorEmail: 'a@x.com',
  dateIso: '2026-09-01T00:00:00Z', refs: [], message: 'first', graph: '*',
};
const COMMIT_B: CommitInfo = { ...COMMIT_A, hash: 'bbb', shortHash: 'bbb', message: 'second' };

const subscribeMock = vi.mocked(subscribeSse);

afterEach(() => {
  vi.unstubAllGlobals();
  subscribeMock.mockReset();
});

describe('useLogPage', () => {
  it('按 query 拼接查询串请求 log 端点并返回分页数据', async () => {
    const page: LogPage = { commits: [COMMIT_A], hasMore: true };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(page), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // 渲染期间访问属性以登记 SWR 依赖（SWR 按访问收集订阅字段）
    let result: { data?: LogPage; error?: unknown; isLoading: boolean } | undefined;
    function Probe() {
      const { data, error, isLoading } = useLogPage('r-page-1', { limit: 10, skip: 20, author: 'Ann', path: 'src' });
      result = { data, error, isLoading };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(page));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-page-1/log?limit=10&skip=20&author=Ann&path=src');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('repoId 为空串：挂 null key 不发请求（条件拉取——分支对比双查询未就绪态）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ commits: [], hasMore: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: LogPage; error?: unknown; isLoading: boolean } | undefined;
    function Probe() {
      const { data, error, isLoading } = useLogPage('', { range: 'master..feature' });
      result = { data, error, isLoading };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toBeUndefined());
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useLogStream', () => {
  function captureSubscription() {
    let captured!: { onEvent: (event: SseEvent) => void; signal?: AbortSignal };
    subscribeMock.mockImplementation(async (_url, onEvent, signal) => {
      captured = { onEvent, signal };
      await new Promise(() => {}); // 长连接：永不 resolve
    });
    return () => captured;
  }

  it('log.line 事件增量追加 commits，卸载时中止订阅', async () => {
    const getCaptured = captureSubscription();

    let result!: ReturnType<typeof useLogStream>;
    function Probe() {
      result = useLogStream('r-stream-1');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });

    expect(subscribeMock).toHaveBeenCalledWith('/api/repos/r-stream-1/log/stream', expect.any(Function), expect.any(AbortSignal));
    expect(result.connected).toBe(true);
    expect(result.commits).toEqual([]);

    const captured = getCaptured();
    await act(async () => {
      captured.onEvent({ type: 'log.line', payload: COMMIT_A });
    });
    expect(result.commits).toEqual([COMMIT_A]);

    await act(async () => {
      captured.onEvent({ type: 'log.line', payload: COMMIT_B });
    });
    expect(result.commits).toEqual([COMMIT_A, COMMIT_B]);

    await act(async () => {
      captured.onEvent({ type: 'diff.chunk', payload: { text: 'x' } });
    });
    expect(result.commits).toEqual([COMMIT_A, COMMIT_B]);

    await act(async () => {
      renderer.unmount();
    });
    expect(captured.signal?.aborted).toBe(true);
  });

  it('流异常断开（非主动取消）时 connected 置 false', async () => {
    subscribeMock.mockRejectedValue(new Error('stream broken'));

    let result!: ReturnType<typeof useLogStream>;
    function Probe() {
      result = useLogStream('r-stream-2');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.connected).toBe(false));
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  it('stream.error 帧：错误消息存入 error 并断开连接（中止订阅）', async () => {
    const getCaptured = captureSubscription();

    let result!: ReturnType<typeof useLogStream>;
    function Probe() {
      result = useLogStream('r-stream-3');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    expect(result.error).toBeNull();

    const captured = getCaptured();
    await act(async () => {
      captured.onEvent({ type: 'stream.error', payload: { message: 'git log 失败' } });
    });
    expect(result.error).toBe('git log 失败');
    expect(result.connected).toBe(false);
    expect(captured.signal?.aborted).toBe(true);

    await act(async () => {
      renderer.unmount();
    });
  });
});
