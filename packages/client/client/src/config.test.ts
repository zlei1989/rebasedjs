/** config.ts 测试：useRepoConfig 拉取 + useSetConfig 突变（PUT 并以响应回写 useRepoConfig 缓存） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigPutBody, GitConfigView } from '@rebased/contracts';
import { useRepoConfig, useSetConfig } from './config';

const INITIAL: GitConfigView = {
  entries: [
    { key: 'user.name', value: 'Alice', localValue: null },
    { key: 'user.email', value: 'alice@example.com', localValue: null },
  ],
};
const UPDATED: GitConfigView = {
  entries: [
    { key: 'user.name', value: 'Bob', localValue: 'Bob' },
    { key: 'user.email', value: 'alice@example.com', localValue: null },
  ],
};
const PUT_BODY: ConfigPutBody = { key: 'user.name', value: 'Bob' };

function freshCache(children: React.ReactNode) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRepoConfig', () => {
  it('GET /api/repos/:repoId/config 返回配置视图', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(INITIAL), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: GitConfigView; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useRepoConfig('r-cfg-1');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(INITIAL));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cfg-1/config');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useSetConfig', () => {
  it('trigger 发起 PUT 并以响应回写 useRepoConfig 缓存；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify(UPDATED), { status: 200 });
      return new Response(JSON.stringify(INITIAL), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: GitConfigView;
      trigger?: (body: ConfigPutBody) => Promise<GitConfigView>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useRepoConfig('r-cfg-2');
      const { trigger, isMutating } = useSetConfig('r-cfg-2');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(INITIAL));
    });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/repos/r-cfg-2/config', expect.objectContaining({ method: 'PUT' }));

    let saved: GitConfigView | undefined;
    await act(async () => {
      saved = await result.trigger!(PUT_BODY);
    });

    expect(saved).toEqual(UPDATED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cfg-2/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PUT_BODY),
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(UPDATED));
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
