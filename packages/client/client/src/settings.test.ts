/** settings.ts 测试：useSettings 拉取 + update 突变（PUT 并回写缓存）+ useGitExecutableInfo 检测 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitExecutableInfo, SettingsState } from '@rebased/contracts';
import { useGitExecutableInfo, useSettings } from './settings';
import { freshCache } from './testing/fresh-cache';

const INITIAL: SettingsState = { logInEditor: false, recentRepoIds: [] };
const UPDATED: SettingsState = { logInEditor: true, recentRepoIds: ['r1'] };

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
