/** gitlab.ts 测试：GitLab 域查询（键/查询串、共挂载去重、iid null 挂 null key 不发请求）+ 五个 mutation（POST 端点、JSON body、响应显式回写 mrs/timeline/detail/mrs+detail/status+branches 键，全程 GET 守卫） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BranchList,
  GitLabCommentBody,
  GitLabDiscussionBody,
  GitLabDiscussions,
  GitLabMrCheckoutResult,
  GitLabMrCreateBody,
  GitLabMrDetail,
  GitLabMrFiles,
  GitLabMrList,
  GitLabMrMergeResult,
  GitLabMrSummary,
  GitLabMergeBody,
  GitLabReviewBody,
  GitLabStatus,
  GitLabTimeline,
  RepoStatus,
} from '@rebased/contracts';
import { useBranches } from './branches';
import {
  useAddGitlabComment,
  useAddGitlabDiscussion,
  useCheckoutGitlabMr,
  useCreateGitlabMr,
  useGitlabDiscussions,
  useGitlabMrDetail,
  useGitlabMrFiles,
  useGitlabMrs,
  useGitlabStatus,
  useGitlabTimeline,
  useMergeGitlabMr,
  useSubmitGitlabReview,
} from './gitlab';
import { useRepoStatus } from './repos';
import { freshCache } from './testing/fresh-cache';

const STATUS_A: GitLabStatus = {
  detected: true,
  repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://gitlab.com/acme/demo.git' },
  account: 'me',
};

const MR_7: GitLabMrSummary = {
  iid: 7,
  title: 'fix: handle empty ref',
  author: 'alice',
  state: 'opened',
  sourceBranch: 'fix-empty-ref',
  targetBranch: 'main',
  createdAtIso: '2026-01-01T00:00:00.000Z',
  updatedAtIso: '2026-01-02T00:00:00.000Z',
};
const MR_8: GitLabMrSummary = {
  iid: 8,
  title: 'docs: README',
  author: 'bob',
  state: 'opened',
  sourceBranch: 'docs-readme',
  targetBranch: 'main',
  createdAtIso: '2026-01-03T00:00:00.000Z',
  updatedAtIso: '2026-01-03T00:00:00.000Z',
};
const LIST_A: GitLabMrList = { mrs: [MR_7, MR_8] };
const LIST_MERGED: GitLabMrList = { mrs: [{ ...MR_7, state: 'merged' }, MR_8] };

const DETAIL_A: GitLabMrDetail = {
  ...MR_7,
  body: 'fixes #42',
  mergeable: true,
  reviewState: 'NONE',
  commentsCount: 0,
  additions: 12,
  deletions: 3,
};
const DETAIL_REVIEWED: GitLabMrDetail = { ...DETAIL_A, reviewState: 'CHANGES_REQUESTED', commentsCount: 1 };
const DETAIL_MERGED: GitLabMrDetail = { ...DETAIL_A, state: 'merged' };
const DETAIL_CREATED: GitLabMrDetail = {
  ...MR_7,
  iid: 11,
  title: 'add code review',
  author: 'me',
  sourceBranch: 'feat/cr',
  body: 'adds a review flow',
  mergeable: true,
  reviewState: 'NONE',
  commentsCount: 0,
  additions: 42,
  deletions: 7,
};

const TIMELINE_A: GitLabTimeline = {
  entries: [{ id: 1, author: 'alice', atIso: '2026-01-01T00:00:00.000Z', body: 'looks good', kind: 'comment' }],
};
const DISCUSSIONS_A: GitLabDiscussions = {
  notes: [{ id: 51, author: 'bob', atIso: '2026-02-01T00:00:00.000Z', body: '这里呢？', newPath: 'src/a.ts', newLine: 5 }],
};
const TIMELINE_B: GitLabTimeline = {
  entries: [
    { id: 2, author: 'me', atIso: '2026-01-02T00:00:00.000Z', body: 'nice work', kind: 'review', reviewState: 'APPROVED' },
    ...TIMELINE_A.entries,
  ],
};

const FILES_A: GitLabMrFiles = {
  files: [{ path: 'src/a.ts', status: 'modified', additions: 0, deletions: 0, diff: '@@ -1 +1 @@' }],
};

const CREATE_BODY: GitLabMrCreateBody = { sourceBranch: 'feat/cr', targetBranch: 'main', title: 'add code review', description: 'adds a review flow' };
const COMMENT_BODY: GitLabCommentBody = { body: 'nice work' };
const REVIEW_BODY: GitLabReviewBody = { event: 'REQUEST_CHANGES', body: 'please add tests' };
const MERGE_BODY: GitLabMergeBody = { squash: true };
const MERGE_OK: GitLabMrMergeResult = { merged: true, message: 'Merge request successfully merged' };
const MERGE_FAIL: GitLabMrMergeResult = { merged: false, message: 'merge conflict' };
const CHECKOUT_RESULT: GitLabMrCheckoutResult = { branchName: 'mr-7' };

const REPO_STATUS_A: RepoStatus = { branch: 'main', upstream: null, headHash: 'a'.repeat(40), ahead: 0, behind: 0, entries: [] };
const REPO_STATUS_B: RepoStatus = { branch: 'mr-7', upstream: null, headHash: 'b'.repeat(40), ahead: 0, behind: 0, entries: [] };
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
  recent: ['main'],
};
const BRANCHES_B: BranchList = {
  branches: [
    {
      name: 'mr-7',
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
  recent: ['main'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGitlabStatus', () => {
  it('以 /api/repos/:repoId/gitlab/status 为键发起 GET 并返回 GitLabStatus', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(STATUS_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabStatus | undefined;
    function Probe() {
      data = useGitlabStatus('r-gl-1').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(STATUS_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-1/gitlab/status');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('共挂载两个同键组件：SWR 去重，仅 1 次 GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(STATUS_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let dataA: GitLabStatus | undefined;
    let dataB: GitLabStatus | undefined;
    function ProbeA() {
      dataA = useGitlabStatus('r-gl-2').data;
      return null;
    }
    function ProbeB() {
      dataB = useGitlabStatus('r-gl-2').data;
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

describe('useGitlabMrs', () => {
  it('以 /api/repos/:repoId/gitlab/mrs?state=… 为键发起 GET（state 恒带查询串）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabMrList | undefined;
    function Probe() {
      data = useGitlabMrs('r-gl-3', 'opened').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-3/gitlab/mrs?state=opened');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('state=all 时键为 /api/repos/:repoId/gitlab/mrs?state=all', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(LIST_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabMrList | undefined;
    function Probe() {
      data = useGitlabMrs('r-gl-4', 'all').data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(LIST_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-4/gitlab/mrs?state=all');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useGitlabMrDetail', () => {
  it('以 /api/repos/:repoId/gitlab/mrs/:iid 为键发起 GET 并返回 GitLabMrDetail', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DETAIL_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabMrDetail | null | undefined;
    function Probe() {
      data = useGitlabMrDetail('r-gl-5', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(DETAIL_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-5/gitlab/mrs/7');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('iid 为 null 时挂 null key：不发请求，data 为 undefined（页面可无条件挂载）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabMrDetail | null | undefined;
    function Probe() {
      data = useGitlabMrDetail('r-gl-6', null).data;
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

describe('useGitlabTimeline', () => {
  it('以 /api/repos/:repoId/gitlab/mrs/:iid/timeline 为键发起 GET 并返回 GitLabTimeline', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(TIMELINE_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabTimeline | null | undefined;
    function Probe() {
      data = useGitlabTimeline('r-gl-7', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(TIMELINE_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-7/gitlab/mrs/7/timeline');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('iid 为 null 时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabTimeline | null | undefined;
    function Probe() {
      data = useGitlabTimeline('r-gl-8', null).data;
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

describe('useGitlabMrFiles', () => {
  it('以 /api/repos/:repoId/gitlab/mrs/:iid/files 为键发起 GET 并返回 GitLabMrFiles', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FILES_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabMrFiles | null | undefined;
    function Probe() {
      data = useGitlabMrFiles('r-gl-9', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(FILES_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-9/gitlab/mrs/7/files');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('iid 为 null 时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabMrFiles | null | undefined;
    function Probe() {
      data = useGitlabMrFiles('r-gl-10', null).data;
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

describe('useGitlabDiscussions', () => {
  it('以 /api/repos/:repoId/gitlab/mrs/:iid/discussions 为键发起 GET 并返回 GitLabDiscussions', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DISCUSSIONS_A), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabDiscussions | null | undefined;
    function Probe() {
      data = useGitlabDiscussions('r-gl-disc', 7).data;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(data).toEqual(DISCUSSIONS_A));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-disc/gitlab/mrs/7/discussions');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('iid 为 null 时挂 null key：不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let data: GitLabDiscussions | null | undefined;
    function Probe() {
      data = useGitlabDiscussions('r-gl-disc2', null).data;
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

describe('useAddGitlabDiscussion', () => {
  it('trigger 发起 POST …/discussions（JSON body），响应显式回写讨论键；全程恰好 1 次 POST', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(DISCUSSIONS_A), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let triggerFn!: (body: GitLabDiscussionBody) => Promise<GitLabDiscussions>;
    function Probe() {
      const { trigger } = useAddGitlabDiscussion('r-gl-disc3', 7);
      triggerFn = trigger;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    let result: GitLabDiscussions | undefined;
    await act(async () => {
      result = await triggerFn({ path: 'src/a.ts', line: 5, body: '锚定评论' });
    });

    expect(result).toEqual(DISCUSSIONS_A);
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST');
    expect((postCall?.[0] as string)).toBe('/api/repos/r-gl-disc3/gitlab/mrs/7/discussions');
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({ path: 'src/a.ts', line: 5, body: '锚定评论' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useCreateGitlabMr', () => {
  it('trigger 发起 POST …/gitlab/mrs（JSON body），响应详情前置插入 opened/all 两 list 键；全程无多余 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(DETAIL_CREATED), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      openedData?: GitLabMrList;
      allData?: GitLabMrList;
      trigger?: (body: GitLabMrCreateBody) => Promise<GitLabMrDetail>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data: openedData } = useGitlabMrs('r-gl-11', 'opened');
      const { data: allData } = useGitlabMrs('r-gl-11', 'all');
      const { trigger, isMutating } = useCreateGitlabMr('r-gl-11');
      result = { openedData, allData, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.openedData).toEqual(LIST_A));
      await vi.waitFor(() => expect(result.allData).toEqual(LIST_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let created: GitLabMrDetail | undefined;
    await act(async () => {
      created = await result.trigger!(CREATE_BODY);
    });

    expect(created).toEqual(DETAIL_CREATED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-11/gitlab/mrs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREATE_BODY),
    });
    // 响应详情前置插入 list 缓存键（新 MR 恒 opened，不进 closed/merged/locked 列表；revalidate:false，不触发二次 GET）
    const LIST_WITH_NEW: GitLabMrList = { mrs: [DETAIL_CREATED, MR_7, MR_8] };
    await act(async () => {
      await vi.waitFor(() => expect(result.openedData).toEqual(LIST_WITH_NEW));
      await vi.waitFor(() => expect(result.allData).toEqual(LIST_WITH_NEW));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(2);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useAddGitlabComment', () => {
  it('trigger 发起 POST …/comments（JSON body），响应 GitLabTimeline 显式回写 timeline 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(TIMELINE_B), { status: 200 });
      return new Response(JSON.stringify(TIMELINE_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: GitLabTimeline | null;
      trigger?: (body: GitLabCommentBody) => Promise<GitLabTimeline>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useGitlabTimeline('r-gl-12', 7);
      const { trigger, isMutating } = useAddGitlabComment('r-gl-12', 7);
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

    let updated: GitLabTimeline | undefined;
    await act(async () => {
      updated = await result.trigger!(COMMENT_BODY);
    });

    expect(updated).toEqual(TIMELINE_B);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-12/gitlab/mrs/7/comments', {
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

describe('useSubmitGitlabReview', () => {
  it('trigger 发起 POST …/review（JSON body），响应 GitLabMrDetail 显式回写 detail 键；全程恰好 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(DETAIL_REVIEWED), { status: 200 });
      return new Response(JSON.stringify(DETAIL_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      data?: GitLabMrDetail | null;
      trigger?: (body: GitLabReviewBody) => Promise<GitLabMrDetail>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data } = useGitlabMrDetail('r-gl-13', 7);
      const { trigger, isMutating } = useSubmitGitlabReview('r-gl-13', 7);
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

    let updated: GitLabMrDetail | undefined;
    await act(async () => {
      updated = await result.trigger!(REVIEW_BODY);
    });

    expect(updated).toEqual(DETAIL_REVIEWED);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-13/gitlab/mrs/7/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REVIEW_BODY),
    });
    // reviewState 变化经 detail 键显式回写（revalidate:false，不触发二次 GET）
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

describe('useMergeGitlabMr', () => {
  it('trigger 发起 POST …/merge（JSON body），merged=true 时回写各 state 列表项 + detail 键（state=merged）；全程各 1 次 GET', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(MERGE_OK), { status: 200 });
      if (_input === '/api/repos/r-gl-14/gitlab/mrs/7') return new Response(JSON.stringify(DETAIL_A), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      openedData?: GitLabMrList;
      allData?: GitLabMrList;
      detailData?: GitLabMrDetail | null;
      trigger?: (body: GitLabMergeBody) => Promise<GitLabMrMergeResult>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data: openedData } = useGitlabMrs('r-gl-14', 'opened');
      const { data: allData } = useGitlabMrs('r-gl-14', 'all');
      const { data: detailData } = useGitlabMrDetail('r-gl-14', 7);
      const { trigger, isMutating } = useMergeGitlabMr('r-gl-14', 7);
      result = { openedData, allData, detailData, trigger, isMutating };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result.openedData).toEqual(LIST_A));
      await vi.waitFor(() => expect(result.allData).toEqual(LIST_A));
      await vi.waitFor(() => expect(result.detailData).toEqual(DETAIL_A));
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));

    let merged: GitLabMrMergeResult | undefined;
    await act(async () => {
      merged = await result.trigger!(MERGE_BODY);
    });

    expect(merged).toEqual(MERGE_OK);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-14/gitlab/mrs/7/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(MERGE_BODY),
    });
    // 合并成功：各 state 列表项与 detail 键显式回写 state=merged（GitLab state 迁移即「已合并」标识；revalidate:false，不触发二次 GET）
    await act(async () => {
      await vi.waitFor(() => expect(result.openedData).toEqual(LIST_MERGED));
      await vi.waitFor(() => expect(result.allData).toEqual(LIST_MERGED));
      await vi.waitFor(() => expect(result.detailData).toEqual(DETAIL_MERGED));
    });
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect(getCalls).toHaveLength(3);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('merged=false（如冲突）时不改动缓存：列表与详情仍为原值', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(MERGE_FAIL), { status: 200 });
      if (_input === '/api/repos/r-gl-15/gitlab/mrs/7') return new Response(JSON.stringify(DETAIL_A), { status: 200 });
      return new Response(JSON.stringify(LIST_A), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      listData?: GitLabMrList;
      detailData?: GitLabMrDetail | null;
      trigger?: (body: GitLabMergeBody) => Promise<GitLabMrMergeResult>;
    } = {};
    function Probe() {
      const { data: listData } = useGitlabMrs('r-gl-15', 'opened');
      const { data: detailData } = useGitlabMrDetail('r-gl-15', 7);
      const { trigger } = useMergeGitlabMr('r-gl-15', 7);
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

    let merged: GitLabMrMergeResult | undefined;
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

describe('useCheckoutGitlabMr', () => {
  it('trigger 发起 POST …/checkout（空体），成功后补刷 status（repo 域）与 branches 键：各 2 次 GET 且订阅者更新', async () => {
    let statusGets = 0;
    let branchesGets = 0;
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(CHECKOUT_RESULT), { status: 200 });
      if (_input === '/api/repos/r-gl-16/status') {
        statusGets += 1;
        return new Response(JSON.stringify(statusGets === 1 ? REPO_STATUS_A : REPO_STATUS_B), { status: 200 });
      }
      if (_input === '/api/repos/r-gl-16/branches') {
        branchesGets += 1;
        return new Response(JSON.stringify(branchesGets === 1 ? BRANCHES_A : BRANCHES_B), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: {
      statusData?: RepoStatus;
      branchesData?: BranchList;
      trigger?: () => Promise<GitLabMrCheckoutResult>;
      isMutating?: boolean;
    } = {};
    function Probe() {
      const { data: statusData } = useRepoStatus('r-gl-16');
      const { data: branchesData } = useBranches('r-gl-16');
      const { trigger, isMutating } = useCheckoutGitlabMr('r-gl-16', 7);
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

    let checkedOut: GitLabMrCheckoutResult | undefined;
    await act(async () => {
      checkedOut = await result.trigger!();
    });

    expect(checkedOut).toEqual(CHECKOUT_RESULT);
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-gl-16/gitlab/mrs/7/checkout', {
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
