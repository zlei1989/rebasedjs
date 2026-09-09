/** rebase.ts 测试：useRebase/useInteractiveRebase/useAutosquash/useCommitEdit/useCheckoutRebase 突变
 *  （POST 各自端点；checkout-rebase 成功后重验证 status/branches 双缓存键）+ useRebaseTodo 查询（base 空串挂 null key 不发请求） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutosquashBody, BranchList, CheckoutRebaseBody, CommitEditBody, InteractiveRebaseBody, RebaseBody, RebaseOutcome, RepoStatus, TodoEntry } from '@rebased/contracts';
import { useAutosquash, useCheckoutRebase, useCommitEdit, useInteractiveRebase, useRebase, useRebaseTodo } from './rebase';
import { useBranches } from './branches';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const REBASE_BODY: RebaseBody = { onto: 'main', branch: 'feature' };
const INTERACTIVE_BODY: InteractiveRebaseBody = {
  base: 'main',
  entries: [
    { hash: 'a'.repeat(40), action: 'pick' },
    { hash: 'b'.repeat(40), action: 'drop' },
  ],
};
const OUTCOME: RebaseOutcome = { status: 'conflicts' };
const TODO: TodoEntry[] = [
  { hash: 'a'.repeat(40), subject: 'feat: first' },
  { hash: 'b'.repeat(40), subject: 'fix: second' },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRebase', () => {
  it('trigger 发起 POST rebase 并返回 RebaseOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: { trigger?: (body: RebaseBody) => Promise<RebaseOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useRebase('r-rb-1');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: RebaseOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(REBASE_BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rb-1/rebase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REBASE_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useRebaseTodo', () => {
  it('以 …/rebase/todo?base= 为键发起 GET 并返回 todo 列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TODO), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: TodoEntry[] | undefined;
    function Probe() {
      data = useRebaseTodo('r-rb-2', 'main').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(TODO));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rb-2/rebase/todo?base=main');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('base 为空串时挂 null key，不发起请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TODO), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: TodoEntry[] | undefined;
    function Probe() {
      data = useRebaseTodo('r-rb-3', '').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    expect(data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useInteractiveRebase', () => {
  it('trigger 发起 POST rebase/interactive 并返回 RebaseOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: { trigger?: (body: InteractiveRebaseBody) => Promise<RebaseOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useInteractiveRebase('r-rb-4');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: RebaseOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(INTERACTIVE_BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rb-4/rebase/interactive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(INTERACTIVE_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useAutosquash', () => {
  it('trigger 发起 POST autosquash（fixup!/squash! 折入）并返回 RebaseOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const BODY: AutosquashBody = { hash: 'aaaaaa', action: 'fixup' };

    let result: { trigger?: (body: AutosquashBody) => Promise<RebaseOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useAutosquash('r-rb-5');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: RebaseOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rb-5/autosquash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCommitEdit', () => {
  it('trigger 发起 POST commit-edit（reword 带 message）并返回 RebaseOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const BODY: CommitEditBody = { hash: 'aaaaaa', action: 'reword', message: '新信息' };

    let result: { trigger?: (body: CommitEditBody) => Promise<RebaseOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useCommitEdit('r-rb-6');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: RebaseOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rb-6/commit-edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCheckoutRebase', () => {
  it('trigger 发起 POST checkout-rebase，成功后重验证 status 与 branches 双缓存键（订阅者收到新值）', async () => {
    const ON_MAIN: RepoStatus = {
      branch: 'main',
      upstream: null,
      headHash: 'a'.repeat(40),
      ahead: 0,
      behind: 0,
      entries: [],
    };
    const ON_SIDE: RepoStatus = { ...ON_MAIN, branch: 'side', headHash: 'b'.repeat(40) };
    const BRANCHES_MAIN: BranchList = {
      branches: [
        { name: 'main', remote: false, current: true, upstream: null, ahead: 0, behind: 0, hash: 'a'.repeat(40), mergedIntoHead: false, lastCommitIso: '2025-01-01T00:00:00Z' },
        { name: 'origin/side', remote: true, current: false, upstream: null, ahead: 0, behind: 0, hash: 'b'.repeat(40), mergedIntoHead: false, lastCommitIso: '2025-01-01T00:00:00Z' },
      ],
    };
    const BRANCHES_SIDE: BranchList = {
      branches: [
        { name: 'main', remote: false, current: false, upstream: null, ahead: 0, behind: 0, hash: 'a'.repeat(40), mergedIntoHead: false, lastCommitIso: '2025-01-01T00:00:00Z' },
        { name: 'side', remote: false, current: true, upstream: 'origin/side', ahead: 0, behind: 0, hash: 'b'.repeat(40), mergedIntoHead: false, lastCommitIso: '2025-01-01T00:00:00Z' },
      ],
    };
    // 首次挂载 GET 返回旧值；POST 后的重验证返回新值（提交后分支切换）
    let statusGets = 0;
    let branchesGets = 0;
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      if (input === '/api/repos/r-rb-7/status') {
        statusGets += 1;
        return new Response(JSON.stringify(statusGets === 1 ? ON_MAIN : ON_SIDE), { status: 200 });
      }
      if (input === '/api/repos/r-rb-7/branches') {
        branchesGets += 1;
        return new Response(JSON.stringify(branchesGets === 1 ? BRANCHES_MAIN : BRANCHES_SIDE), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const BODY: CheckoutRebaseBody = { branch: 'origin/side' };

    let result: {
      status?: RepoStatus | undefined;
      branches?: BranchList | undefined;
      trigger?: (body: CheckoutRebaseBody) => Promise<RebaseOutcome>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data: status } = useRepoStatus('r-rb-7');
      const { data: branches } = useBranches('r-rb-7');
      const { trigger, isMutating } = useCheckoutRebase('r-rb-7');
      result = { status, branches, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.status).toEqual(ON_MAIN));
      await vi.waitFor(() => expect(result.branches).toEqual(BRANCHES_MAIN));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: RebaseOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-rb-7/checkout-rebase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    // 双键重验证：status/branches 各追加一次 GET，订阅者收到新值
    await act(async () => {
      await vi.waitFor(() => expect(result.status).toEqual(ON_SIDE));
      await vi.waitFor(() => expect(result.branches).toEqual(BRANCHES_SIDE));
    });
    expect(statusGets).toBe(2);
    expect(branchesGets).toBe(2);
    await act(async () => {
      renderer.unmount();
    });
  });
});
