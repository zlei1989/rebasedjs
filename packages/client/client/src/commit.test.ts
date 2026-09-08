/** commit.ts 测试：useCommit / useCommitAndPush 突变（POST message 等请求体，返回 {hash} / CommitAndPushOutcome，不自动请求）+ useAmendTargets/useAmendSpecificCommit */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AmendSpecificBody, AmendTarget, CommitAndPushBody, CommitAndPushOutcome, CommitBody } from '@rebased/contracts';
import { useAmendSpecificCommit, useAmendTargets, useCommit, useCommitAndPush } from './commit';
import { freshCache } from './testing/fresh-cache';

const HASH = 'b'.repeat(40);
const COMMIT_BODY: CommitBody = { message: 'feat: x', signOff: true };
const OUTCOME: CommitAndPushOutcome = { commit: { hash: HASH }, push: { status: 'pushed' } };
const COMBINED_BODY: CommitAndPushBody = { message: 'feat: x', push: { remote: 'origin', setUpstream: true } };
const AMEND_TARGETS: AmendTarget[] = [
  { hash: 'a'.repeat(40), subject: 'c2' },
  { hash: 'b'.repeat(40), subject: 'c1' },
];
const AMEND_BODY: AmendSpecificBody = { targetHash: AMEND_TARGETS[0].hash, message: 'c2（重写）' };

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

describe('useAmendTargets', () => {
  it('GET 端点返回 AmendTarget[]（新→旧候选列表）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(AMEND_TARGETS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: AmendTarget[]; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useAmendTargets('r-cmt-3');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(AMEND_TARGETS));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cmt-3/commit/amend-targets');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('repoId 空串挂 null key 不发请求（条件拉取）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(AMEND_TARGETS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    function Probe() {
      useAmendTargets('');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useAmendSpecificCommit', () => {
  it('trigger 发起 POST commit/amend-specific 并返回 {status,hash?}；挂载时不自动请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'success', hash: HASH }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      trigger?: (body: AmendSpecificBody) => Promise<{ status: string; hash?: string }>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { trigger, isMutating } = useAmendSpecificCommit('r-cmt-4');
      result = { trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    let out: { status: string; hash?: string } | undefined;
    await act(async () => {
      out = await result.trigger!(AMEND_BODY);
    });

    expect(out).toEqual({ status: 'success', hash: HASH });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-cmt-4/commit/amend-specific', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(AMEND_BODY),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
