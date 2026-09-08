/** commit.ts 测试：useCommit / useCommitAndPush 突变（POST message 等请求体，返回 {hash} / CommitAndPushOutcome，不自动请求） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitAndPushBody, CommitAndPushOutcome, CommitBody } from '@rebased/contracts';
import { useCommit, useCommitAndPush } from './commit';
import { freshCache } from './testing/fresh-cache';

const HASH = 'b'.repeat(40);
const COMMIT_BODY: CommitBody = { message: 'feat: x', signOff: true };
const OUTCOME: CommitAndPushOutcome = { commit: { hash: HASH }, push: { status: 'pushed' } };
const COMBINED_BODY: CommitAndPushBody = { message: 'feat: x', push: { remote: 'origin', setUpstream: true } };

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
    expect(result.isMutating).toBe(false);

    let committed: { hash: string } | undefined;
    await act(async () => {
      committed = await result.trigger!(COMMIT_BODY);
    });

    expect(committed).toEqual({ hash: HASH });
    expect(result.isMutating).toBe(false);
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

describe('useCommitAndPush', () => {
  it('trigger 发起 POST commit/push 并返回 CommitAndPushOutcome；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(OUTCOME), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      trigger?: (body: CommitAndPushBody) => Promise<CommitAndPushOutcome>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { trigger, isMutating } = useCommitAndPush('r-cmt-2');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    let outcome: CommitAndPushOutcome | undefined;
    await act(async () => {
      outcome = await result.trigger!(COMBINED_BODY);
    });

    expect(outcome).toEqual(OUTCOME);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cmt-2/commit/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(COMBINED_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
