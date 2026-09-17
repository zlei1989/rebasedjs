/** diff.ts 测试：useFileDiff/useDiffPatch 查询串（FileVersions/DiffFile，两者空 file 均走 null key）
 *  + useHeldFileDiff 翻文件期间保留上一对 {file, versions} + useDiffStream 分块累积/stream.error/断开清理（mock subscribeSse） */
import { act, createElement, useState } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BranchWorkingDiff, DiffFile, FileThreeVersions, FileVersions, SseEvent } from '@rebased/contracts';
import { subscribeSse } from './events';
import { useBranchWorkingDiff, useDiffPatch, useDiffStream, useFileDiff, useFileThreeWay, useHeldFileDiff } from './diff';
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

  it('file 为空串时挂 null key 不发请求（条件拉取：日志页变更集差异标签的常态是没有激活文件）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ before: '', after: '' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: FileVersions; isLoading: boolean } | undefined;
    function Probe() {
      const { data, isLoading } = useFileDiff('r-diff-empty', '');
      result = { data, isLoading };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.isLoading).toBe(false));
    });

    expect(result?.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useHeldFileDiff（翻文件期间保留上一份全文——页面据此不卸载 Monaco）', () => {
  /**
   * 夹具：a.ts 立即就绪，b.ts 挂起（由用例手动放行）。
   * Probe 用「文件路径可变 + 自增 tick 重渲染」驱动换 key，保证 SWR 缓存与组件实例不变（贴近真实翻文件）。
   */
  function setupHeldProbe(repoId: string, hangOn: (url: string) => boolean = (url) => url.includes('file=b.ts')) {
    const A: FileVersions = { before: 'a-old', after: 'a-new' };
    const B: FileVersions = { before: 'b-old', after: 'b-new' };
    let releaseB!: () => void;
    const fetchMock = vi.fn(async (url: string) => {
      if (hangOn(url)) {
        await new Promise<void>((resolve) => {
          releaseB = resolve;
        });
        return new Response(JSON.stringify(B), { status: 200 });
      }
      return new Response(JSON.stringify(A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    let currentFile = 'a.ts';
    let currentRepo = repoId;
    let bump!: () => void;
    let result: ReturnType<typeof useHeldFileDiff> | undefined;
    function Probe() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      result = useHeldFileDiff(currentRepo, currentFile, false);
      return null;
    }
    return {
      A,
      B,
      release: () => releaseB(),
      current: () => result,
      goTo: (next: { file?: string; repoId?: string }) => {
        if (next.file !== undefined) currentFile = next.file;
        if (next.repoId !== undefined) currentRepo = next.repoId;
        bump();
      },
      probe: Probe,
    };
  }

  it('新文件全文未到时沿用上一对 {file, versions}；到达后原子切到新的一对', async () => {
    const h = setupHeldProbe('r-hold-1');
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(h.probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(h.current()?.data).toEqual({ file: 'a.ts', versions: h.A }));
    });

    // 翻到 b.ts：b 的全文还在路上 → 仍返回 a 的一对（页面据此继续渲染，编辑器不卸载）
    await act(async () => {
      h.goTo({ file: 'b.ts' });
    });
    expect(h.current()?.data).toEqual({ file: 'a.ts', versions: h.A });

    // b 的全文到达 → 文件名与内容同批换（不出现「新名字配旧内容」）
    await act(async () => {
      h.release();
      await vi.waitFor(() => expect(h.current()?.data).toEqual({ file: 'b.ts', versions: h.B }));
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('首次进入（没有上一份可顶）时不保留：data 保持 undefined，交给流式视图', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {})); // 永不返回
    vi.stubGlobal('fetch', fetchMock);

    let result: ReturnType<typeof useHeldFileDiff> | undefined;
    function Probe() {
      result = useHeldFileDiff('r-hold-2', 'a.ts', false);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    expect(result?.data).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('换仓库不顶上一个仓库的全文（held 带 repoId 归属判据）', async () => {
    // 换到的新仓库请求挂起 → 只剩「上一个仓库的 held」这条路径可走
    const h = setupHeldProbe('r-hold-3', (url) => url.includes('r-hold-4'));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(h.probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(h.current()?.data).toEqual({ file: 'a.ts', versions: h.A }));
    });

    // 同键（a.ts）换到 r-hold-4 且新仓库的全文本还没到 → 不得沿用 r-hold-3 的全文
    await act(async () => {
      h.goTo({ repoId: 'r-hold-4' });
    });
    expect(h.current()?.data).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('error 原样透传（端点失败时页面据此走错误分支）', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: ReturnType<typeof useHeldFileDiff> | undefined;
    function Probe() {
      result = useHeldFileDiff('r-hold-5', 'a.ts', false);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.error).toBeTruthy());
    });
    expect(result?.data).toBeUndefined();
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

describe('useFileThreeWay', () => {
  it('按 file 拼接查询串请求 three-way 端点并返回 FileThreeVersions', async () => {
    const THREE: FileThreeVersions = { head: 'v1', staged: 'v2', working: 'v3' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(THREE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: FileThreeVersions; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useFileThreeWay('r-diff-6', 'a.txt');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(THREE));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-diff-6/diff/three-way?file=a.txt');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('file 为空串时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: FileThreeVersions; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useFileThreeWay('r-diff-7', '');
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

describe('useBranchWorkingDiff（GitShowDiffWithRefAction 语义）', () => {
  it('按 branch 拼接查询串请求 branch-working 端点并返回 BranchWorkingDiff', async () => {
    const VIEW: BranchWorkingDiff = {
      branch: 'dev',
      files: [{ path: 'a.txt', status: 'M' }],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(VIEW), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BranchWorkingDiff; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBranchWorkingDiff('r-diff-8', 'dev');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(VIEW));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-diff-8/diff/branch-working?branch=dev');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('branch 为空串时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: BranchWorkingDiff; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useBranchWorkingDiff('r-diff-9', '');
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

    expect(subscribeMock).toHaveBeenCalledWith(
      '/api/repos/r-diff-2/diff/stream?file=b.ts&staged=false',
      expect.any(Function),
      expect.any(AbortSignal),
    );
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

  it('staged/from/to 同参透传：分块流与全文查询同口径（渐进渲染，Ruling 6）', async () => {
    let captured!: { onEvent: (event: SseEvent) => void; signal?: AbortSignal };
    subscribeMock.mockImplementation(async (_url, onEvent, signal) => {
      captured = { onEvent, signal };
      await new Promise(() => {});
    });

    let result!: ReturnType<typeof useDiffStream>;
    function Probe() {
      result = useDiffStream('r-diff-4', 'd.ts', true, 'aaaaaa~1', 'bbbbbb');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
    });

    expect(subscribeMock).toHaveBeenCalledWith(
      '/api/repos/r-diff-4/diff/stream?file=d.ts&staged=true&from=aaaaaa%7E1&to=bbbbbb',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});
