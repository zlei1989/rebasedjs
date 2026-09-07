/** submodule.ts 测试：查询（键/共挂载去重）+ 更新 mutation（POST 端点、JSON body、响应显式回写 submodules 键，全程 GET 守卫） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubmoduleEntry, SubmoduleList, SubmoduleUpdateBody } from '@rebased/contracts';
import { useSubmodules, useUpdateSubmodules } from './submodule';
import { freshCache } from './testing/fresh-cache';

const SUB_A: SubmoduleEntry = {
  name: 'sub',
  path: 'sub',
  url: 'C:/sub.git',
  status: 'different-commit',
  commitSha: 'a'.repeat(40),
};
const SUB_B: SubmoduleEntry = {
  name: 'sub',
  path: 'sub',
  url: 'C:/sub.git',
  status: 'checked-out',
  commitSha: 'b'.repeat(40),
};
const LIST_A: SubmoduleList = { submodules: [SUB_A] };
const LIST_B: SubmoduleList = { submodules: [SUB_B] };

const UPDATE_BODY: SubmoduleUpdateBody = { name: 'sub', recursive: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSubmodules', () => {
  it('以 /api/repos/:repoId/submodules 为键发起 GET 并返回 SubmoduleList', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: SubmoduleList | undefined;
    function Probe() {
      data = useSubmodules('r-sm-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-sm-1/submodules');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('共挂载两个同键组件：SWR 去重，仅 1 次 GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let dataA: SubmoduleList | undefined;
    let dataB: SubmoduleList | undefined;
    function ProbeA() {
      dataA = useSubmodules('r-sm-2').data;
      return null;
    }
    function ProbeB() {
      dataB = useSubmodules('r-sm-2').data;
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

describe('useUpdateSubmodules', () => {
  it('trigger 发起 POST …/submodules/update（JSON body），响应列表显式回写 submodules 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: SubmoduleList;
      trigger?: (body: SubmoduleUpdateBody) => Promise<SubmoduleList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useSubmodules('r-sm-3');
      const { trigger, isMutating } = useUpdateSubmodules('r-sm-3');
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

    let updated: SubmoduleList | undefined;
    await act(async () => {
      updated = await result.trigger!(UPDATE_BODY);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-sm-3/submodules/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(UPDATE_BODY),
    });
    // 响应刷新列表显式回写 submodules 缓存键（revalidate:false，不触发二次 GET）
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
