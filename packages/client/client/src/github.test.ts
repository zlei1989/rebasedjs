/** github.ts 测试：GitHub 域查询（键/查询串、共挂载去重、number null 挂 null key 不发请求）+ 四个 mutation（POST 端点、JSON body、响应显式回写 timeline/detail/prs+detail/status+branches 键，全程 1-GET 守卫） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BranchList,
  GitHubCommentBody,
  GitHubMergeBody,
  GitHubPrCheckoutResult,
  GitHubPrDetail,
  GitHubPrFiles,
  GitHubPrList,
  GitHubPrMergeResult,
  GitHubPrSummary,
  GitHubReviewBody,
  GitHubStatus,
  GitHubTimeline,
  RepoStatus,
} from '@rebased/contracts';
import { useBranches } from './branches';
import {
  useAddGithubComment,
  useCheckoutGithubPr,
  useGithubPrDetail,
  useGithubPrFiles,
  useGithubPrs,
  useGithubStatus,
  useGithubTimeline,
  useMergeGithubPr,
  useSubmitGithubReview,
} from './github';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const STATUS_A: GitHubStatus = {
  detected: true,
  repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://github.com/acme/demo.git' },
  account: 'me',
};

const PR_7: GitHubPrSummary = {
  number: 7,
  title: 'fix: handle empty ref',
  author: 'alice',
  state: 'open',
  merged: false,
  baseRef: 'main',
  headRef: 'fix-empty-ref',
  createdAtIso: '2026-01-01T00:00:00.000Z',
  updatedAtIso: '2026-01-02T00:00:00.000Z',
};
const PR_8: GitHubPrSummary = {
  number: 8,
  title: 'docs: README',
  author: 'bob',
  state: 'open',
  merged: false,
  baseRef: 'main',
  headRef: 'docs-readme',
  createdAtIso: '2026-01-03T00:00:00.000Z',
  updatedAtIso: '2026-01-03T00:00:00.000Z',
};
const LIST_A: GitHubPrList = { prs: [PR_7, PR_8] };
const LIST_MERGED: GitHubPrList = { prs: [{ ...PR_7, merged: true }, PR_8] };

const DETAIL_A: GitHubPrDetail = {
  ...PR_7,
  body: 'fixes #42',
  mergeable: true,
  reviewDecision: 'NONE',
  commentsCount: 0,
  additions: 12,
  deletions: 3,
};
const DETAIL_REVIEWED: GitHubPrDetail = { ...DETAIL_A, reviewDecision: 'CHANGES_REQUESTED', commentsCount: 1 };
const DETAIL_MERGED: GitHubPrDetail = { ...DETAIL_A, merged: true };

const TIMELINE_A: GitHubTimeline = {
  entries: [{ id: 1, author: 'alice', atIso: '2026-01-01T00:00:00.000Z', body: 'looks good', kind: 'comment' }],
};
const TIMELINE_B: GitHubTimeline = {
  entries: [
    { id: 2, author: 'me', atIso: '2026-01-02T00:00:00.000Z', body: 'nice work', kind: 'review', reviewState: 'APPROVED' },
    ...TIMELINE_A.entries,
  ],
};

const FILES_A: GitHubPrFiles = {
  files: [{ path: 'src/a.ts', status: 'modified', additions: 12, deletions: 3, patch: '@@ -1 +1 @@' }],
};

const COMMENT_BODY: GitHubCommentBody = { body: 'nice work' };
const REVIEW_BODY: GitHubReviewBody = { event: 'REQUEST_CHANGES', body: 'please add tests' };
const MERGE_BODY: GitHubMergeBody = { method: 'squash' };
const MERGE_OK: GitHubPrMergeResult = { merged: true, message: 'Pull request successfully merged' };
const MERGE_FAIL: GitHubPrMergeResult = { merged: false, message: 'merge conflict' };
const CHECKOUT_RESULT: GitHubPrCheckoutResult = { branchName: 'pr-7' };

const REPO_STATUS_A: RepoStatus = { branch: 'main', upstream: null, headHash: 'a'.repeat(40), ahead: 0, behind: 0, entries: [] };
const REPO_STATUS_B: RepoStatus = { branch: 'pr-7', upstream: null, headHash: 'b'.repeat(40), ahead: 0, behind: 0, entries: [] };
const BRANCHES_A: BranchList = {
  branches: [
    {
      name: 'main',
      remote: false,
      current: true,
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      hash: 'a'.repeat(40),
      mergedIntoHead: false,
      lastCommitIso: '2026-01-01T00:00:00.000Z',
    },
  ],
};
const BRANCHES_B: BranchList = {
  branches: [
    {
      name: 'pr-7',
      remote: false,
      current: true,
      upstream: null,
      ahead: 0,
      behind: 0,
      hash: 'b'.repeat(40),
      mergedIntoHead: false,
      lastCommitIso: '2026-01-02T00:00:00.000Z',
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGithubStatus', () => {
  it('以 /api/repos/:repoId/github/status 为键发起 GET 并返回 GitHubStatus', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(STATUS_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubStatus | undefined;
    function Probe() {
      data = useGithubStatus('r-gh-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(STATUS_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-1/github/status');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('共挂载两个同键组件：SWR 去重，仅 1 次 GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(STATUS_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let dataA: GitHubStatus | undefined;
    let dataB: GitHubStatus | undefined;
    function ProbeA() {
      dataA = useGithubStatus('r-gh-2').data;
      return null;
    }
    function ProbeB() {
      dataB = useGithubStatus('r-gh-2').data;
      return null;
    }
    function Parent() {
      return createElement('div', null, createElement(ProbeA), createElement(ProbeB));
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Parent)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(dataA).toEqual(STATUS_A));
      await vi.waitFor(() => expect(dataB).toEqual(STATUS_A));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useGithubPrs', () => {
  it('以 /api/repos/:repoId/github/prs?state=… 为键发起 GET（state 恒带查询串）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubPrList | undefined;
    function Probe() {
      data = useGithubPrs('r-gh-3', 'open').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-3/github/prs?state=open');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('state=all 时键为 /api/repos/:repoId/github/prs?state=all', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubPrList | undefined;
    function Probe() {
      data = useGithubPrs('r-gh-4', 'all').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-4/github/prs?state=all');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useGithubPrDetail', () => {
  it('以 /api/repos/:repoId/github/prs/:number 为键发起 GET 并返回 GitHubPrDetail', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DETAIL_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubPrDetail | null | undefined;
    function Probe() {
      data = useGithubPrDetail('r-gh-5', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(DETAIL_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-5/github/prs/7');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('number 为 null 时挂 null key：不发请求，data 为 undefined（页面可无条件挂载）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubPrDetail | null | undefined;
    function Probe() {
      data = useGithubPrDetail('r-gh-6', null).data;
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

describe('useGithubTimeline', () => {
  it('以 /api/repos/:repoId/github/prs/:number/timeline 为键发起 GET 并返回 GitHubTimeline', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TIMELINE_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubTimeline | null | undefined;
    function Probe() {
      data = useGithubTimeline('r-gh-7', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(TIMELINE_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-7/github/prs/7/timeline');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('number 为 null 时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubTimeline | null | undefined;
    function Probe() {
      data = useGithubTimeline('r-gh-8', null).data;
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

describe('useGithubPrFiles', () => {
  it('以 /api/repos/:repoId/github/prs/:number/files 为键发起 GET 并返回 GitHubPrFiles', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FILES_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubPrFiles | null | undefined;
    function Probe() {
      data = useGithubPrFiles('r-gh-9', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(FILES_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-9/github/prs/7/files');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('number 为 null 时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitHubPrFiles | null | undefined;
    function Probe() {
      data = useGithubPrFiles('r-gh-10', null).data;
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

describe('useAddGithubComment', () => {
  it('trigger 发起 POST …/comments（JSON body），响应 GitHubTimeline 显式回写 timeline 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(TIMELINE_B), { status: 200 });
      return new Response(JSON.stringify(TIMELINE_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: GitHubTimeline | null;
      trigger?: (body: GitHubCommentBody) => Promise<GitHubTimeline>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useGithubTimeline('r-gh-11', 7);
      const { trigger, isMutating } = useAddGithubComment('r-gh-11', 7);
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(TIMELINE_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let updated: GitHubTimeline | undefined;
    await act(async () => {
      updated = await result.trigger!(COMMENT_BODY);
    });

    expect(updated).toEqual(TIMELINE_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-11/github/prs/7/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(COMMENT_BODY),
    });
    // 响应值显式回写 timeline 缓存键（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(TIMELINE_B));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useSubmitGithubReview', () => {
  it('trigger 发起 POST …/review（JSON body），响应 GitHubPrDetail 显式回写 detail 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(DETAIL_REVIEWED), { status: 200 });
      return new Response(JSON.stringify(DETAIL_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: GitHubPrDetail | null;
      trigger?: (body: GitHubReviewBody) => Promise<GitHubPrDetail>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useGithubPrDetail('r-gh-12', 7);
      const { trigger, isMutating } = useSubmitGithubReview('r-gh-12', 7);
      result = { data, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(DETAIL_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let updated: GitHubPrDetail | undefined;
    await act(async () => {
      updated = await result.trigger!(REVIEW_BODY);
    });

    expect(updated).toEqual(DETAIL_REVIEWED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-12/github/prs/7/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REVIEW_BODY),
    });
    // reviewDecision 变化经 detail 键显式回写（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.data).toEqual(DETAIL_REVIEWED));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useMergeGithubPr', () => {
  it('trigger 发起 POST …/merge（JSON body），merged=true 时回写 prs 列表项 + detail 键（merged:true）；全程各 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(MERGE_OK), { status: 200 });
      if (_input === '/api/repos/r-gh-13/github/prs/7') return new Response(JSON.stringify(DETAIL_A), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      listData?: GitHubPrList;
      detailData?: GitHubPrDetail | null;
      trigger?: (body: GitHubMergeBody) => Promise<GitHubPrMergeResult>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data: listData } = useGithubPrs('r-gh-13', 'open');
      const { data: detailData } = useGithubPrDetail('r-gh-13', 7);
      const { trigger, isMutating } = useMergeGithubPr('r-gh-13', 7);
      result = { listData, detailData, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.listData).toEqual(LIST_A));
      await vi.waitFor(() => expect(result.detailData).toEqual(DETAIL_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let merged: GitHubPrMergeResult | undefined;
    await act(async () => {
      merged = await result.trigger!(MERGE_BODY);
    });

    expect(merged).toEqual(MERGE_OK);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-13/github/prs/7/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(MERGE_BODY),
    });
    // 合并成功：prs 列表项与 detail 键显式回写 merged:true（revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.listData).toEqual(LIST_MERGED));
      await vi.waitFor(() => expect(result.detailData).toEqual(DETAIL_MERGED));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(2);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('merged=false（如冲突）时不改动缓存：列表与详情仍为原值', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(MERGE_FAIL), { status: 200 });
      if (_input === '/api/repos/r-gh-14/github/prs/7') return new Response(JSON.stringify(DETAIL_A), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      listData?: GitHubPrList;
      detailData?: GitHubPrDetail | null;
      trigger?: (body: GitHubMergeBody) => Promise<GitHubPrMergeResult>;
    } = {};
    function Probe() {
      const { data: listData } = useGithubPrs('r-gh-14', 'open');
      const { data: detailData } = useGithubPrDetail('r-gh-14', 7);
      const { trigger } = useMergeGithubPr('r-gh-14', 7);
      result = { listData, detailData, trigger };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.listData).toEqual(LIST_A));
      await vi.waitFor(() => expect(result.detailData).toEqual(DETAIL_A));
    });

    let merged: GitHubPrMergeResult | undefined;
    await act(async () => {
      merged = await result.trigger!(MERGE_BODY);
    });

    expect(merged).toEqual(MERGE_FAIL);
    expect(result.listData).toEqual(LIST_A);
    expect(result.detailData).toEqual(DETAIL_A);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCheckoutGithubPr', () => {
  it('trigger 发起 POST …/checkout（空体），成功后补刷 status（repo 域）与 branches 键：各 2 次 GET 且订阅者更新', async () => {
    let statusGets = 0;
    let branchesGets = 0;
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(CHECKOUT_RESULT), { status: 200 });
      if (_input === '/api/repos/r-gh-15/status') {
        statusGets += 1;
        return new Response(JSON.stringify(statusGets === 1 ? REPO_STATUS_A : REPO_STATUS_B), { status: 200 });
      }
      if (_input === '/api/repos/r-gh-15/branches') {
        branchesGets += 1;
        return new Response(JSON.stringify(branchesGets === 1 ? BRANCHES_A : BRANCHES_B), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      statusData?: RepoStatus;
      branchesData?: BranchList;
      trigger?: () => Promise<GitHubPrCheckoutResult>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data: statusData } = useRepoStatus('r-gh-15');
      const { data: branchesData } = useBranches('r-gh-15');
      const { trigger, isMutating } = useCheckoutGithubPr('r-gh-15', 7);
      result = { statusData, branchesData, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.statusData).toEqual(REPO_STATUS_A));
      await vi.waitFor(() => expect(result.branchesData).toEqual(BRANCHES_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let checkedOut: GitHubPrCheckoutResult | undefined;
    await act(async () => {
      checkedOut = await result.trigger!();
    });

    expect(checkedOut).toEqual(CHECKOUT_RESULT);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gh-15/github/prs/7/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    // 跨键补刷（P3-D restore 先例：全局 mutate 重取 status/branches 键）→ 订阅者拿到新值
    await act(async () => {
      await vi.waitFor(() => expect(result.statusData).toEqual(REPO_STATUS_B));
      await vi.waitFor(() => expect(result.branchesData).toEqual(BRANCHES_B));
    });
    expect(statusGets).toBe(2);
    expect(branchesGets).toBe(2);
    await act(async () => {
      renderer.unmount();
    });
  });
});
