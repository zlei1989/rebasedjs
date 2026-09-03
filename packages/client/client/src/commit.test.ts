/** commit.ts 测试：useCommit 突变（POST message 等请求体，返回 {hash}，不自动请求） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitBody } from '@rebased/contracts';
import { useCommit } from './commit';
import { freshCache } from './testing/fresh-cache';

const HASH = 'b'.repeat(40);
const COMMIT_BODY: CommitBody = { message: 'feat: x', signOff: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCommit', () => {
  it('trigger 发起 POST commit 并返回 {hash}；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ hash: HASH }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      trigger?: (body: CommitBody) => Promise<{ hash: string }>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { trigger, isMutating } = useCommit('r-cmt-1');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    let committed: { hash: string } | undefined;
    await act(async () => {
      committed = await result.trigger!(COMMIT_BODY);
    });

    expect(committed).toEqual({ hash: HASH });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cmt-1/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(COMMIT_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
