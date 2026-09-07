/** worktree.ts 测试：查询（键/共挂载去重）+ 三个 mutation（POST 端点、JSON body、响应显式回写 worktrees 键，全程 GET 守卫） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeCreateBody, WorktreeEntry, WorktreeList, WorktreeRemoveBody } from '@rebased/contracts';
import { useCreateWorktree, usePruneWorktrees, useRemoveWorktree, useWorktrees } from './worktree';
import { freshCache } from './testing/fresh-cache';

const WT_MAIN: WorktreeEntry = { path: 'C:/repo', branch: 'main', detached: false, head: 'a'.repeat(40) };
const WT_SIDE: WorktreeEntry = { path: 'C:/repo-wt', branch: 'feat-1', detached: false, head: 'b'.repeat(40) };
const LIST_A: WorktreeList = { worktrees: [WT_MAIN] };
const LIST_B: WorktreeList = { worktrees: [WT_MAIN, WT_SIDE] };

const CREATE_BODY: WorktreeCreateBody = { path: 'C:/repo-wt', newBranch: 'feat-1' };
const REMOVE_BODY: WorktreeRemoveBody = { path: 'C:/repo-wt', force: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWorktrees', () => {
  it('以 /api/repos/:repoId/worktrees 为键发起 GET 并返回 WorktreeList', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: WorktreeList | undefined;
    function Probe() {
      data = useWorktrees('r-wt-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-wt-1/worktrees');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('共挂载两个同键组件：SWR 去重，仅 1 次 GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let dataA: WorktreeList | undefined;
    let dataB: WorktreeList | undefined;
    function ProbeA() {
      dataA = useWorktrees('r-wt-2').data;
      return null;
    }
    function ProbeB() {
      dataB = useWorktrees('r-wt-2').data;
      return null;
    }
    function Parent() {
      return createElement('div', null, createElement(ProbeA), createElement(ProbeB));
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Parent)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(dataA).toEqual(LIST_A));
      await vi.waitFor(() => expect(dataB).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCreateWorktree', () => {
  it('trigger 发起 POST …/worktrees（JSON body），响应列表显式回写 worktrees 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: WorktreeList;
      trigger?: (body: WorktreeCreateBody) => Promise<WorktreeList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useWorktrees('r-wt-3');
      const { trigger, isMutating } = useCreateWorktree('r-wt-3');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let created: WorktreeList | undefined;
    await act(async () => {
      created = await result.trigger!(CREATE_BODY);
    });

    expect(created).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-wt-3/worktrees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREATE_BODY),
    });
    // 响应刷新列表显式回写 worktrees 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useRemoveWorktree', () => {
  it('trigger 发起 POST …/worktrees/remove（JSON body），响应列表显式回写 worktrees 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_A), { status: 200 });
      return new Response(JSON.stringify(LIST_B), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: WorktreeList;
      trigger?: (body: WorktreeRemoveBody) => Promise<WorktreeList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useWorktrees('r-wt-4');
      const { trigger, isMutating } = useRemoveWorktree('r-wt-4');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_B));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let removed: WorktreeList | undefined;
    await act(async () => {
      removed = await result.trigger!(REMOVE_BODY);
    });

    expect(removed).toEqual(LIST_A);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-wt-4/worktrees/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REMOVE_BODY),
    });
    // 响应刷新列表显式回写 worktrees 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_A));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('usePruneWorktrees', () => {
  it('trigger 发起 POST …/worktrees/prune（空体 {}），响应列表显式回写 worktrees 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_A), { status: 200 });
      return new Response(JSON.stringify(LIST_B), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: WorktreeList;
      trigger?: () => Promise<WorktreeList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useWorktrees('r-wt-5');
      const { trigger, isMutating } = usePruneWorktrees('r-wt-5');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_B));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let pruned: WorktreeList | undefined;
    await act(async () => {
      pruned = await result.trigger!();
    });

    expect(pruned).toEqual(LIST_A);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-wt-5/worktrees/prune', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    // 响应刷新列表显式回写 worktrees 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_A));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
