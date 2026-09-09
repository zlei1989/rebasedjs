/**
 * web-next GitLab MR 域路由测试：status 三态、MR 列表/创建/详情/时间线/文件、评论、review（approve/reject/comment）、
 * merge 与 checkout（数据面全部 mock fetch，绝不打真实网络）。
 * 拆分自原 routes.test.ts 的 'web-next GitLab MR 域路由' describe：原单文件 194s 是测试提速瓶颈，
 * 按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAccount } from '@rebased/api';
import { GET as getGitlabStatus } from '../app/api/repos/[repoId]/gitlab/status/route';
import { GET as getGitlabMrs, POST as postGitlabMrCreate } from '../app/api/repos/[repoId]/gitlab/mrs/route';
import { GET as getGitlabMrDetail } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/route';
import { GET as getGitlabMrTimeline } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/timeline/route';
import { POST as postGitlabComment } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/comments/route';
import { GET as getGitlabMrFiles } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/files/route';
import { POST as postGitlabReview } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/review/route';
import { POST as postGitlabMerge } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/merge/route';
import { POST as postGitlabCheckout } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/checkout/route';
import { cleanupTestEnv, ctx, lastRepoPath, registerRepo, setupTestEnv, tmpDir } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next GitLab MR 域路由', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/merge-requests），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'glpat-route-test-token-1234567890';
  /** [iid] 子路由 ctx：与既有 ctx 同构，多 iid 路径段 */
  const iidCtx = (repoId: string, iid: string): { params: Promise<{ repoId: string; iid: string }> } => ({
    params: Promise.resolve({ repoId, iid }),
  });
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + gitlab.com 远程（origin = https://gitlab.com/acme/demo.git），返回 repoId */
  const gitlabRepo = (): string => {
    const repoId = registerRepo();
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', 'https://gitlab.com/acme/demo.git']);
    return repoId;
  };
  /** 配置 gitlab.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
  /** mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止） */
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  const mockFetchSequence = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce(
        new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers }),
      );
    }
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** GitLab API project 基址：owner 全路径（含子组）encodeURIComponent 后为 acme%2Fdemo */
  const MR_BASE = 'https://gitlab.com/api/v4/projects/acme%2Fdemo';
  /** GitLab MR JSON 夹具（toMrSummary 所需字段齐） */
  const mrFixture = (overrides: Record<string, unknown> = {}) => ({
    iid: 12,
    title: 'Fix thing',
    author: { username: 'alice' },
    state: 'opened',
    source_branch: 'feature/fix',
    target_branch: 'main',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T03:04:05Z',
    ...overrides,
  });
  /** MR 详情夹具（toMrDetail 所需字段齐：merge_status/user_notes_count） */
  const mrDetailFixture = (overrides: Record<string, unknown> = {}) => ({
    iid: 7,
    title: 'Detail',
    author: { username: 'carol' },
    state: 'opened',
    source_branch: 'fix',
    target_branch: 'main',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    description: 'Description',
    merge_status: 'can_be_merged',
    user_notes_count: 3,
    ...overrides,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 端点：无远程 → 200 {detected:false}（三态之一）', async () => {
    const repoId = registerRepo();
    const res = await getGitlabStatus(new Request(`http://localhost/api/repos/${repoId}/gitlab/status`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const repoId = gitlabRepo();
    const res = await getGitlabStatus(new Request(`http://localhost/api/repos/${repoId}/gitlab/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://gitlab.com/acme/demo.git' },
    });
    expect((body as { account?: string }).account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await getGitlabStatus(new Request(`http://localhost/api/repos/${repoId}/gitlab/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ detected: true, account: 'me' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await getGitlabStatus(new Request('http://localhost/api/repos/nope/gitlab/status'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('mrs 端点：state 缺省 opened 透传（URL 与 PRIVATE-TOKEN 注入）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [mrFixture()] });
    const res = await getGitlabMrs(new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mrs: [
        {
          iid: 12,
          title: 'Fix thing',
          author: 'alice',
          state: 'opened',
          sourceBranch: 'feature/fix',
          targetBranch: 'main',
          createdAtIso: '2026-01-01T00:00:00Z',
          updatedAtIso: '2026-01-02T03:04:05Z',
        },
      ],
    });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests?state=opened`);
    expect(init.headers).toMatchObject({ 'PRIVATE-TOKEN': TOKEN });
  });

  it('mrs 端点：state=merged 透传 query', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [] });
    const res = await getGitlabMrs(new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs?state=merged`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mrs: [] });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests?state=merged`);
  });

  it('mrs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await getGitlabMrs(new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs?state=merge`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('create 端点：POST 载荷（sourceBranch/targetBranch/title/description）与重查 detail 回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      {
        status: 201,
        json: {
          iid: 11,
          title: 'New MR',
          author: { username: 'me' },
          state: 'opened',
          source_branch: 'feature',
          target_branch: 'main',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          description: 'D',
        },
      },
      {
        json: {
          iid: 11,
          title: 'New MR',
          author: { username: 'me' },
          state: 'opened',
          source_branch: 'feature',
          target_branch: 'main',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          description: 'D',
          merge_status: 'checking',
          user_notes_count: 0,
        },
      },
      { json: [] },
    );
    const res = await postGitlabMrCreate(
      jsonPost(`${repoId}/gitlab/mrs`, { sourceBranch: 'feature', targetBranch: 'main', title: 'New MR', description: 'D' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ iid: 11, title: 'New MR', body: 'D' });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ source_branch: 'feature', target_branch: 'main', title: 'New MR', description: 'D' }),
    );
    // 重查 detail 走 GET /merge_requests/11（create 返回后）。
    expect((mock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/11`);
  });

  it('create 端点：缺 targetBranch（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGitlabMrCreate(
      jsonPost(`${repoId}/gitlab/mrs`, { sourceBranch: 'feature', title: 'No target' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('detail 端点：mock fetch 断言 URL 序列（MR + 尽力 reviews）与映射', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await getGitlabMrDetail(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7`),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      iid: 7,
      title: 'Detail',
      author: 'carol',
      state: 'opened',
      sourceBranch: 'fix',
      targetBranch: 'main',
      createdAtIso: '2026-01-01T00:00:00Z',
      updatedAtIso: '2026-01-02T00:00:00Z',
      body: 'Description',
      mergeable: true,
      reviewState: 'APPROVED',
      commentsCount: 3,
      additions: 0,
      deletions: 0,
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7`);
    expect((mock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('path 参数：iid=0 / iid=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    for (const bad of ['0', 'abc']) {
      const res = await getGitlabMrDetail(
        new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/${bad}`),
        iidCtx(repoId, bad),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('timeline 端点：notes + reviews 两请求 URL 与合并升序（review id 移位）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      {
        json: [
          { id: 5, author: { username: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' },
          { id: 6, author: { username: 'bob' }, created_at: '2026-01-03T00:00:00Z', body: 'comment 3' },
        ],
      },
      {
        json: [
          { id: 12, state: 'approved', author: { username: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' },
          { id: 13, state: 'rejected', author: { username: 'dave' }, created_at: '2026-01-04T00:00:00Z', body: 'needs work' },
          { id: 14, state: 'commented', author: { username: 'erin' }, created_at: '2026-01-05T00:00:00Z', body: 'hmm' },
        ],
      },
    );
    const res = await getGitlabMrTimeline(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7/timeline`),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
        { id: 1000000012, author: 'carol', atIso: '2026-01-02T00:00:00Z', body: 'lgtm', kind: 'review', reviewState: 'APPROVED' },
        { id: 6, author: 'bob', atIso: '2026-01-03T00:00:00Z', body: 'comment 3', kind: 'comment' },
        { id: 1000000013, author: 'dave', atIso: '2026-01-04T00:00:00Z', body: 'needs work', kind: 'review', reviewState: 'CHANGES_REQUESTED' },
        { id: 1000000014, author: 'erin', atIso: '2026-01-05T00:00:00Z', body: 'hmm', kind: 'review', reviewState: 'COMMENTED' },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect((mock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('files 端点：mock fetch 断言 URL 与映射（new_path ?? old_path；旗标；diff 缺省 → 空串）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({
      json: [
        { new_path: 'a.ts', old_path: 'a.ts', diff: '@@ -1 +1 @@', new_file: false, deleted_file: false },
        { new_path: 'new.ts', old_path: null, new_file: true, deleted_file: false },
        { new_path: 'renamed.ts', old_path: 'old.ts', renamed_file: true, new_file: true, deleted_file: false },
        { new_path: null, old_path: 'del.ts', deleted_file: true, new_file: false },
        { new_path: 'm.ts', old_path: 'm.ts', new_file: false, deleted_file: false, renamed_file: false, diff: null },
      ],
    });
    const res = await getGitlabMrFiles(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7/files`),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 0, deletions: 0, diff: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 0, deletions: 0, diff: '' },
        { path: 'renamed.ts', status: 'renamed', additions: 0, deletions: 0, diff: '' },
        { path: 'del.ts', status: 'removed', additions: 0, deletions: 0, diff: '' },
        { path: 'm.ts', status: 'modified', additions: 0, deletions: 0, diff: '' },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/changes`);
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包（note + notes + reviews 三请求）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postGitlabComment(
      jsonPost(`${repoId}/gitlab/mrs/7/comments`, { body: 'new comment' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'APPROVED' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('review 端点：APPROVE → POST .../approve（无 body）与刷新详情回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 200, json: { id: 1, state: 'approved' } },
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'APPROVE', body: 'looks good' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('APPROVED');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/approve`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('review 端点：REQUEST_CHANGES → POST .../reviews {state:rejected} 与刷新详情回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 2, state: 'rejected' } },
      { json: mrDetailFixture({ user_notes_count: 0 }) },
      {
        json: [{ id: 21, state: 'rejected', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'nope' }],
      },
    );
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'REQUEST_CHANGES', body: 'nope' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('CHANGES_REQUESTED');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/reviews`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ state: 'rejected' }));
  });

  it('review 端点：COMMENT → POST .../notes {body} 与刷新详情回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 3, body: 'need fix', author: { username: 'me' } } },
      { json: mrDetailFixture({ user_notes_count: 1 }) },
      { json: [] },
    );
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'COMMENT', body: 'need fix' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { commentsCount: number }).commentsCount).toBe(1);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'need fix' }));
  });

  it('merge 端点：squash 类型非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGitlabMerge(
      jsonPost(`${repoId}/gitlab/mrs/7/merge`, { squash: 'yes' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('merge 端点：PUT {squash:true} 载荷与回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ status: 200, json: { state: 'merged', message: 'Merge request merged successfully' } });
    const res = await postGitlabMerge(
      jsonPost(`${repoId}/gitlab/mrs/7/merge`, { squash: true }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Merge request merged successfully' });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/merge`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ squash: true }));
  });

  it('checkout 端点：真实裸仓库 refs/merge-requests/7/head → mr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-next-gitlab-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-next-gitlab-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'mr.txt'), 'mr-7 content');
    execFileSync('git', ['-C', other, 'add', 'mr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'mr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/merge-requests/7/head']);
    const mrHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/merge-requests/7/head'], { encoding: 'utf8' }).trim();

    const res = await postGitlabCheckout(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7/checkout`, { method: 'POST' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'mr-7' });
    expect(execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('mr-7');
    expect(execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'refs/heads/mr-7'], { encoding: 'utf8' }).trim()).toBe(mrHash);
    expect(execFileSync('git', ['-C', lastRepoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：gitlab 全部 10 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getGitlabStatus(new Request('http://localhost/api/repos/nope/gitlab/status'), ctx('nope')),
      getGitlabMrs(new Request('http://localhost/api/repos/nope/gitlab/mrs'), ctx('nope')),
      postGitlabMrCreate(jsonPost('nope/gitlab/mrs', { sourceBranch: 'a', targetBranch: 'b', title: 't' }), ctx('nope')),
      getGitlabMrDetail(new Request('http://localhost/api/repos/nope/gitlab/mrs/7'), iidCtx('nope', '7')),
      getGitlabMrTimeline(new Request('http://localhost/api/repos/nope/gitlab/mrs/7/timeline'), iidCtx('nope', '7')),
      postGitlabComment(jsonPost('nope/gitlab/mrs/7/comments', { body: 'x' }), iidCtx('nope', '7')),
      getGitlabMrFiles(new Request('http://localhost/api/repos/nope/gitlab/mrs/7/files'), iidCtx('nope', '7')),
      postGitlabReview(jsonPost('nope/gitlab/mrs/7/review', { event: 'APPROVE' }), iidCtx('nope', '7')),
      postGitlabMerge(jsonPost('nope/gitlab/mrs/7/merge', { squash: true }), iidCtx('nope', '7')),
      postGitlabCheckout(new Request('http://localhost/api/repos/nope/gitlab/mrs/7/checkout', { method: 'POST' }), iidCtx('nope', '7')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
