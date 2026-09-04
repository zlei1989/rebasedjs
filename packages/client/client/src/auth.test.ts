/** auth.ts 测试：useAccounts 查询 + useUpsertAccount（同键回写）/useDeleteAccount（跨键回写）突变 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountBody, AccountDeleteBody, AccountList } from '@rebased/contracts';
import { useAccounts, useDeleteAccount, useUpsertAccount } from './auth';
import { freshCache } from './testing/fresh-cache';

const LIST_A: AccountList = {
  accounts: [{ host: 'github.com', account: 'alice', tokenPreview: 'abcd***' }],
};
const LIST_B: AccountList = {
  accounts: [
    { host: 'github.com', account: 'alice', tokenPreview: 'abcd***' },
    { host: 'gitlab.example.com', account: 'bob', tokenPreview: 'efgh***' },
  ],
};
const LIST_C: AccountList = { accounts: [] };
const UPSERT_BODY: AccountBody = { host: 'gitlab.example.com', account: 'bob', token: 'efgh-secret-token' };
const DELETE_BODY: AccountDeleteBody = { host: 'github.com', account: 'alice' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAccounts', () => {
  it('以 /api/auth/accounts 为键发起 GET 并返回账户列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: AccountList | undefined;
    function Probe() {
      data = useAccounts().data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/accounts');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useUpsertAccount', () => {
  it('trigger 发起 POST /api/auth/accounts 并以响应回写 useAccounts 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_B), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: AccountList;
      trigger?: (body: AccountBody) => Promise<AccountList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useAccounts();
      const { trigger, isMutating } = useUpsertAccount();
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

    let updated: AccountList | undefined;
    await act(async () => {
      updated = await result.trigger!(UPSERT_BODY);
    });

    expect(updated).toEqual(LIST_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(UPSERT_BODY),
    });
    // 响应值显式回写 accounts 缓存键（revalidate:false，不触发二次 GET）
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

describe('useDeleteAccount', () => {
  it('trigger 发起 POST /api/auth/accounts/delete 并以响应回写 useAccounts 缓存；挂载时不自动 POST；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(LIST_C), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: AccountList;
      trigger?: (body: AccountDeleteBody) => Promise<AccountList>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useAccounts();
      const { trigger, isMutating } = useDeleteAccount();
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

    let updated: AccountList | undefined;
    await act(async () => {
      updated = await result.trigger!(DELETE_BODY);
    });

    expect(updated).toEqual(LIST_C);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/accounts/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(DELETE_BODY),
    });
    // 响应值跨键回写 accounts 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(LIST_C));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
