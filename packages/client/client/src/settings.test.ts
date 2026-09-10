/** settings.ts 测试：useSettings 拉取 + update 突变（PUT 并回写缓存）+ useGitExecutableInfo 检测 + GPG 配置两 hooks */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitExecutableInfo, GpgConfigBody, GpgConfigView, SettingsState } from '@rebased/contracts';
import { useGitExecutableInfo, useGpgConfig, useSettings, useSetGpgConfig } from './settings';
import { freshCache } from './testing/fresh-cache';

const INITIAL: SettingsState = { logInEditor: false, recentRepoIds: [], protectedBranchPatterns: [], theme: 'dark' };
const UPDATED: SettingsState = { logInEditor: true, recentRepoIds: ['r1'], protectedBranchPatterns: [], theme: 'light' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSettings', () => {
  it('GET /api/settings 返回设置；update 发起 PUT 并以响应回写缓存', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify(UPDATED), { status: 200 });
      return new Response(JSON.stringify(INITIAL), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: { settings?: SettingsState; update?: ReturnType<typeof useSettings>['update']; isLoading?: boolean } = {};
    function Probe() {
      const { settings, update, isLoading, isUpdating } = useSettings();
      void isUpdating;
      result = { settings, update, isLoading };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.settings).toEqual(INITIAL));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/settings');

    await act(async () => {
      await result.update!({ logInEditor: true, recentRepoIds: ['r1'] });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logInEditor: true, recentRepoIds: ['r1'] }),
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.settings).toEqual(UPDATED));
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useGitExecutableInfo', () => {
  it('GET /api/settings/git-executable 返回 GitExecutableInfo', async () => {
    const INFO: GitExecutableInfo = { exec: 'git', version: 'git version 2.47.0', ok: true };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(INFO), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: GitExecutableInfo; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useGitExecutableInfo();
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(INFO));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/settings/git-executable');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useGpgConfig / useSetGpgConfig', () => {
  const VIEW: GpgConfigView = {
    enabled: false,
    key: null,
    keys: [{ id: 'A'.repeat(16), description: 'Test User <test@example.com>' }],
  };
  const VIEW_UPDATED: GpgConfigView = { enabled: true, key: 'A'.repeat(16), keys: VIEW.keys };

  it('GET …/settings/gpg-config 返回视图；trigger 发起 PUT 并以响应回写缓存', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify(VIEW_UPDATED), { status: 200 });
      return new Response(JSON.stringify(VIEW), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: GpgConfigView;
      trigger?: (body: GpgConfigBody) => Promise<GpgConfigView>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useGpgConfig('r-gpg-1');
      const { trigger, isMutating } = useSetGpgConfig('r-gpg-1');
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(VIEW));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'PUT' }));

    const BODY: GpgConfigBody = { enabled: true, key: 'A'.repeat(16) };
    let updated: GpgConfigView | undefined;
    await act(async () => {
      updated = await result.trigger!(BODY);
    });

    expect(updated).toEqual(VIEW_UPDATED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gpg-1/settings/gpg-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    // 响应显式回写 useGpgConfig 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(VIEW_UPDATED));
    });
    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
