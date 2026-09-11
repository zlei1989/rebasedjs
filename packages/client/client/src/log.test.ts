/** log.ts 测试：useLogPage 查询串拼接 + useLogPages 阶梯分页累积 + useLogStream 增量追加/断开清理（mock subscribeSse） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitInfo, LogPage, SseEvent } from '@rebased/contracts';
import { subscribeSse } from './events';
import { LOG_FIRST_PAGE, LOG_MAX_PAGE, logPageSize, logPageSkip, useLogPage, useLogPages, useLogStream } from './log';

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

describe('日志分页阶梯（logPageSize/logPageSkip）', () => {
  it('页大小 50→100→200→400→500 封顶；skip 是前面各页之和（不重不漏）', () => {
    expect(LOG_FIRST_PAGE).toBe(50);
    expect(LOG_MAX_PAGE).toBe(500);
    expect([0, 1, 2, 3, 4, 5, 9].map(logPageSize)).toEqual([50, 100, 200, 400, 500, 500, 500]);
    expect([0, 1, 2, 3, 4, 5, 9].map(logPageSkip)).toEqual([0, 50, 150, 350, 750, 1250, 3250]);
    // 不重不漏的另一半：每页 skip + 页大小 = 下一页 skip
    for (let i = 0; i < 6; i++) {
      expect(logPageSkip(i) + logPageSize(i)).toBe(logPageSkip(i + 1));
    }
  });
});

describe('useLogPages（按需加载到最早一条）', () => {
  /** 造 count 条提交（hash 带序号，便于断言拼接顺序与去重） */
  function makeCommits(count: number, startIndex = 0): CommitInfo[] {
    return Array.from({ length: count }, (_, i) => ({
      ...COMMIT_A,
      hash: `h${startIndex + i}`,
      shortHash: `h${startIndex + i}`,
      message: `commit ${startIndex + i}`,
    }));
  }

  /** 假服务端：total 条历史，按 limit/skip 切页；hasMore 口径与 getLogPage 一致（整页即还有更多） */
  function stubLogServer(total: number, onCall?: (url: string) => void) {
    const fetchMock = vi.fn(async (url: string) => {
      onCall?.(String(url));
      const u = new URL(String(url), 'http://localhost');
      const limit = Number(u.searchParams.get('limit'));
      const skip = Number(u.searchParams.get('skip'));
      const count = Math.max(0, Math.min(limit, total - skip));
      const page: LogPage = { commits: makeCommits(count, skip), hasMore: count === limit };
      return new Response(JSON.stringify(page), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  /** 渲染探针：把 hook 返回值暴露给用例（渲染期读属性以登记 SWR 依赖） */
  async function mountPages(repoId: string): Promise<{ current: ReturnType<typeof useLogPages>; unmount: () => Promise<void> }> {
    const box = { current: undefined as unknown as ReturnType<typeof useLogPages> };
    function Probe() {
      box.current = useLogPages(repoId);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    return {
      get current() {
        return box.current;
      },
      unmount: async () => {
        await act(async () => {
          renderer.unmount();
        });
      },
    } as { current: ReturnType<typeof useLogPages>; unmount: () => Promise<void> };
  }

  it('首屏只取第一页（limit=50&skip=0）；loadMore 按阶梯追加下一页并累积', async () => {
    const calls: string[] = [];
    stubLogServer(300, (url) => calls.push(url));
    const probe = await mountPages('r-pages-1');
    await act(async () => {
      await vi.waitFor(() => expect(probe.current.commits).toHaveLength(50));
    });
    expect(calls).toEqual(['/api/repos/r-pages-1/log?limit=50&skip=0']);
    expect(probe.current.hasMore).toBe(true);
    expect(probe.current.size).toBe(1);
    expect(probe.current.commits[0].hash).toBe('h0');
    expect(probe.current.commits[49].hash).toBe('h49');

    // 追加第二页：skip 必须接在第一页末尾（50），页大小翻倍到 100 —— 不重不漏
    await act(async () => {
      await vi.waitFor(() => expect(probe.current.loadingMore).toBe(false));
    });
    await act(async () => {
      probe.current.loadMore();
      await vi.waitFor(() => expect(probe.current.commits).toHaveLength(150));
    });
    expect(calls).toEqual([
      '/api/repos/r-pages-1/log?limit=50&skip=0',
      '/api/repos/r-pages-1/log?limit=100&skip=50',
    ]);
    expect(probe.current.commits[50].hash).toBe('h50');
    expect(probe.current.commits[149].hash).toBe('h149');
    expect(new Set(probe.current.commits.map((c) => c.hash)).size).toBe(150);
    await probe.unmount();
  });

  it('一直 loadMore 直到服务端 hasMore=false（最早一条到位）后停手：不再发请求', async () => {
    const calls: string[] = [];
    stubLogServer(200, (url) => calls.push(url));
    const probe = await mountPages('r-pages-2');
    await act(async () => {
      await vi.waitFor(() => expect(probe.current.commits).toHaveLength(50));
    });
    // 50 → +100 → +50（第三页只要到 200 就到底：200-150=50 < limit 200 → hasMore false）
    for (const expected of [150, 200]) {
      await act(async () => {
        await vi.waitFor(() => expect(probe.current.loadingMore).toBe(false));
      });
      await act(async () => {
        probe.current.loadMore();
        await vi.waitFor(() => expect(probe.current.commits).toHaveLength(expected));
      });
    }
    expect(calls).toHaveLength(3);
    expect(probe.current.hasMore).toBe(false);
    // 已到最早一条：再调 loadMore 既不发请求也不改数据（getKey 返回 null → SWR 主动停）
    await act(async () => {
      probe.current.loadMore();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls).toHaveLength(3);
    expect(probe.current.commits).toHaveLength(200);
    // 历史最后一条确实在列表里（这正是「展示最早的一条」的验收点）
    expect(probe.current.commits[199].hash).toBe('h199');
    await probe.unmount();
  });

  it('同 hash 跨页重复时去重（分页期间仓库被改写导致页边界错位）', async () => {
    // 假服务端故意让每页都返回同一批 hash：拼接结果不得出现重复行
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ commits: makeCommits(10), hasMore: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const probe = await mountPages('r-pages-3');
    await act(async () => {
      await vi.waitFor(() => expect(probe.current.commits).toHaveLength(10));
    });
    await act(async () => {
      await vi.waitFor(() => expect(probe.current.loadingMore).toBe(false));
    });
    await act(async () => {
      probe.current.loadMore();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });
    expect(probe.current.commits).toHaveLength(10);
    expect(new Set(probe.current.commits.map((c) => c.hash)).size).toBe(10);
    await probe.unmount();
  });

  it('repoId 为空串：挂 null key 不发请求；过滤条件进查询串', async () => {
    const calls: string[] = [];
    stubLogServer(200, (url) => calls.push(url));
    const empty = await mountPages('');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls).toEqual([]);
    expect(empty.current.commits).toEqual([]);
    expect(empty.current.hasMore).toBe(false);
    await empty.unmount();

    // 过滤条件：author/path 进查询串，skip/limit 仍在（按需加载对过滤视图同样成立）
    const box = { current: undefined as unknown as ReturnType<typeof useLogPages> };
    function Probe() {
      box.current = useLogPages('r-pages-4', { author: 'Ann', path: 'src' });
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(box.current.commits).toHaveLength(50));
    });
    expect(calls).toEqual(['/api/repos/r-pages-4/log?limit=50&skip=0&author=Ann&path=src']);
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
