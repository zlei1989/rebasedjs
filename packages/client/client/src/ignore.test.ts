/** ignore.ts 测试：useIgnore/useIgnoreTemplates 查询 + usePutIgnore/useAddIgnore 突变（响应显式回写 ignore 缓存键） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IgnoreAddBody, IgnoreContents, IgnorePutBody, IgnoreTemplate } from '@rebased/contracts';
import { useAddIgnore, useIgnore, useIgnoreTemplates, usePutIgnore } from './ignore';
import { freshCache } from './testing/fresh-cache';

const CONTENTS_A: IgnoreContents = { gitignore: '# node\nnode_modules/\n', exclude: '' };
const CONTENTS_B: IgnoreContents = { gitignore: '# node\nnode_modules/\nbuild/\n', exclude: '# local\nfoo.tmp' };
const PUT_BODY: IgnorePutBody = { target: 'gitignore', content: '# node\nnode_modules/\nbuild/\n' };
const ADD_BODY: IgnoreAddBody = { path: 'build/' };
const TEMPLATES: IgnoreTemplate[] = [{ id: 'node', name: 'Node', content: 'node_modules/\n' }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useIgnore', () => {
  it('以 /api/repos/:repoId/ignore 为键发起 GET 并返回忽略配置视图', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CONTENTS_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: IgnoreContents | undefined;
    function Probe() {
      data = useIgnore('r-ig-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(CONTENTS_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-ig-1/ignore');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('usePutIgnore', () => {
  it('trigger 发起 PUT ignore 并以响应回写 useIgnore 缓存；挂载时不自动请求；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify(CONTENTS_B), { status: 200 });
      return new Response(JSON.stringify(CONTENTS_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: IgnoreContents;
      trigger?: (body: IgnorePutBody) => Promise<IgnoreContents>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useIgnore('r-ig-2');
      const { trigger, isMutating } = usePutIgnore('r-ig-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(CONTENTS_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'PUT' }));

    let updated: IgnoreContents | undefined;
    await act(async () => {
      updated = await result.trigger!(PUT_BODY);
    });

    expect(updated).toEqual(CONTENTS_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-ig-2/ignore', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PUT_BODY),
    });
    // 响应值显式回写 ignore 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(CONTENTS_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'PUT');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useAddIgnore', () => {
  it('trigger 发起 POST ignore/add（body 仅 {path}），新 IgnoreContents 显式回写 useIgnore 缓存；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(CONTENTS_B), { status: 200 });
      return new Response(JSON.stringify(CONTENTS_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: IgnoreContents;
      trigger?: (body: IgnoreAddBody) => Promise<IgnoreContents>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useIgnore('r-ig-3');
      const { trigger, isMutating } = useAddIgnore('r-ig-3');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(CONTENTS_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let updated: IgnoreContents | undefined;
    await act(async () => {
      updated = await result.trigger!(ADD_BODY);
    });

    expect(updated).toEqual(CONTENTS_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-ig-3/ignore/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADD_BODY),
    });
    // 新 IgnoreContents 显式回写 ignore 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(CONTENTS_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useIgnoreTemplates', () => {
  it('以 /api/repos/:repoId/ignore/templates 为键发起 GET 并返回模板列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TEMPLATES), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: IgnoreTemplate[] | undefined;
    function Probe() {
      data = useIgnoreTemplates('r-ig-4').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(TEMPLATES));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-ig-4/ignore/templates');
    await act(async () => {
      renderer.unmount();
    });
  });
});
