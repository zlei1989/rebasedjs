/** update.ts 测试：useUpdateProject 突变（POST strategy 请求体，返回 UpdateOutcome，不自动请求） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateBody, UpdateOutcome } from '@rebased/contracts';
import { useUpdateProject } from './update';
import { freshCache } from './testing/fresh-cache';

const UPDATE_BODY: UpdateBody = { strategy: 'rebase' };
const UPDATE_OUTCOME: UpdateOutcome = { fetched: ['refs/remotes/origin/main'], pull: { status: 'updated' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateProject', () => {
  it('trigger 发起 POST update 并返回 UpdateOutcome；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(UPDATE_OUTCOME), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      trigger?: (body: UpdateBody) => Promise<UpdateOutcome>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { trigger, isMutating } = useUpdateProject('r-up-1');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isMutating).toBe(false);

    let outcome: UpdateOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(UPDATE_BODY);
    });

    expect(outcome).toEqual(UPDATE_OUTCOME);
    expect(result.isMutating).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-up-1/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(UPDATE_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
