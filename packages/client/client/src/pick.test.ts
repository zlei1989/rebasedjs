/** pick.ts 测试：useCherryPick/useRevert 突变（POST 各自端点，共用 PickBody 载荷） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PickBody, PickOutcome } from '@rebased/contracts';
import { useCherryPick, useRevert } from './pick';
import { freshCache } from './testing/fresh-cache';

const PICK_BODY: PickBody = { hashes: ['a'.repeat(40), 'b'.repeat(40)] };
const OUTCOME: PickOutcome = { status: 'success' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCherryPick', () => {
  it('trigger 发起 POST cherry-pick 并返回 PickOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: { trigger?: (body: PickBody) => Promise<PickOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useCherryPick('r-pk-1');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: PickOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(PICK_BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-pk-1/cherry-pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PICK_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useRevert', () => {
  it('trigger 发起 POST revert 并返回 PickOutcome；挂载时不自动 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(OUTCOME), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: { trigger?: (body: PickBody) => Promise<PickOutcome>; isMutating?: boolean } = {};
    function Probe() {
      const { trigger, isMutating } = useRevert('r-pk-2');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let outcome: PickOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(PICK_BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-pk-2/revert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PICK_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
