/** rebase.ts 测试：useRebase/useInteractiveRebase/useAutosquash 突变（POST 各自端点）+ useRebaseTodo 查询（base 空串挂 null key 不发请求） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutosquashBody, InteractiveRebaseBody, RebaseBody, RebaseOutcome, TodoEntry } from '@rebased/contracts';
import { useAutosquash, useInteractiveRebase, useRebase, useRebaseTodo } from './rebase';
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
