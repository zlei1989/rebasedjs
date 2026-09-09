/** branches.ts 测试：useBranches 查询 + useBranchAction 突变（POST 并以响应显式回写 branches 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BranchAction, BranchList } from '@rebased/contracts';
import { useBranchAction, useBranches } from './branches';
import { freshCache } from './testing/fresh-cache';

const LIST_A: BranchList = {
  branches: [
    {
      name: 'main',
      remote: false,
      current: true,
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      hash: 'a'.repeat(40),
      mergedIntoHead: false,
      lastCommitIso: '2026-01-01T00:00:00.000Z',
    },
  ],
  recent: ['main'],
};
const LIST_B: BranchList = {
  branches: [
    ...LIST_A.branches,
    {
      name: 'feature',
      remote: false,
      current: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      hash: 'b'.repeat(40),
      mergedIntoHead: false,
      lastCommitIso: '2026-01-02T00:00:00.000Z',
    },
  ],
  recent: ['main'],
};
const CREATE_ACTION: BranchAction = { action: 'create', name: 'feature' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBranches', () => {
  it('以 /api/repos/:repoId/branches 为键发起 GET 并返回分支列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: BranchList | undefined;
    function Probe() {
      data = useBranches('r-br-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-br-1/branches');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useBranchAction', () => {
  it('trigger 发起 POST branches 并以响应回写 useBranches 缓存；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: BranchList;
      trigger?: (action: BranchAction) => Promise<BranchList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useBranches('r-br-2');
      const { trigger, isMutating } = useBranchAction('r-br-2');
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

    let updated: BranchList | undefined;
    await act(async () => {
      updated = await result.trigger!(CREATE_ACTION);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-br-2/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREATE_ACTION),
    });
    // 响应值显式回写 branches 缓存键（revalidate:false，不触发二次 GET）
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
