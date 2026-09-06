/** patch.ts 测试：usePatches 查询（含共挂载去重）+ create/apply/delete mutation（POST 子路径，响应显式回写 patches / status 键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PatchApplyBody, PatchCreateBody, PatchDeleteBody, PatchList, RepoStatus } from '@rebased/contracts';
import { useApplyPatch, useCreatePatch, useDeletePatch, usePatches } from './patch';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const LIST_A: PatchList = {
  patches: [{ name: 'fix-main', size: 1024, createdAtIso: '2026-01-01T00:00:00.000Z' }],
};
const LIST_B: PatchList = {
  patches: [
    { name: 'feat-p2', size: 2048, createdAtIso: '2026-01-02T00:00:00.000Z' },
    ...LIST_A.patches,
  ],
};
const CREATE_BODY: PatchCreateBody = { name: 'feat-p2', from: 'HEAD~1', to: 'HEAD', staged: true };
const APPLY_BODY: PatchApplyBody = { name: 'fix-main' };
const DELETE_BODY: PatchDeleteBody = { name: 'feat-p2' };
const STATUS_A: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'a'.repeat(40),
  ahead: 0,
  behind: 0,
  entries: [],
};
const STATUS_B: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'b'.repeat(40),
  ahead: 1,
  behind: 0,
  entries: [{ path: 'x.txt', code: 'M' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePatches', () => {
  it('以 /api/repos/:repoId/patches 为键发起 GET 并返回补丁列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: PatchList | undefined;
    function Probe() {
      data = usePatches('r-p-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-p-1/patches');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('共挂载两个同键组件：SWR 去重，仅 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let dataA: PatchList | undefined;
    let dataB: PatchList | undefined;
    function ProbeA() {
      dataA = usePatches('r-p-2').data;
      return null;
    }
    function ProbeB() {
      dataB = usePatches('r-p-2').data;
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

    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCreatePatch', () => {
  it('trigger 发起 POST patches/create 并以响应回写 usePatches 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: PatchList;
      trigger?: (body: PatchCreateBody) => Promise<PatchList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = usePatches('r-p-3');
      const { trigger, isMutating } = useCreatePatch('r-p-3');
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

    let updated: PatchList | undefined;
    await act(async () => {
      updated = await result.trigger!(CREATE_BODY);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-p-3/patches/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREATE_BODY),
    });
    // 响应值显式回写 patches 缓存键（revalidate:false，不触发二次 GET）
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

describe('useApplyPatch', () => {
  it('trigger 发起 POST patches/apply，响应 RepoStatus 显式回写 status 键（useRepoStatus 可见）；status 不重复 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(STATUS_B), { status: 200 });
      if (_input === '/api/repos/r-p-4/status') return new Response(JSON.stringify(STATUS_A), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      statusData?: RepoStatus;
      trigger?: (body: PatchApplyBody) => Promise<RepoStatus>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoStatus('r-p-4');
      const { trigger, isMutating } = useApplyPatch('r-p-4');
      result = { statusData: data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.statusData).toEqual(STATUS_A));
    });

    let applied: RepoStatus | undefined;
    await act(async () => {
      applied = await result.trigger!(APPLY_BODY);
    });

    expect(applied).toEqual(STATUS_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-p-4/patches/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(APPLY_BODY),
    });
    // RepoStatus 显式回写 status 键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.statusData).toEqual(STATUS_B));
    });
    const statusGets = fetchMock.mock.calls.filter(
      ([input, init]) => input === '/api/repos/r-p-4/status' && (init as RequestInit | undefined)?.method !== 'POST',
    );
    expect(statusGets).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useDeletePatch', () => {
  it('trigger 发起 POST patches/delete 并以响应回写 usePatches 缓存；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_A), { status: 200 });
      return new Response(JSON.stringify(LIST_B), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: PatchList;
      trigger?: (body: PatchDeleteBody) => Promise<PatchList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = usePatches('r-p-5');
      const { trigger, isMutating } = useDeletePatch('r-p-5');
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

    let updated: PatchList | undefined;
    await act(async () => {
      updated = await result.trigger!(DELETE_BODY);
    });

    expect(updated).toEqual(LIST_A);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-p-5/patches/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(DELETE_BODY),
    });
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
