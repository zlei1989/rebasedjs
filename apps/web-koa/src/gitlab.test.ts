/**
 * web-koa GitLab MR 域端点集成测试（拆分自 app.test.ts）。
 * 职责：gitlab/status（三态检测）、mrs 列表/create/detail/timeline/files/comments/review/merge 数据面路由
 * （mock 全局 fetch 断言 URL、PRIVATE-TOKEN 注入与字段映射，绝不打真实网络）、checkout（真实裸仓库
 * refs/merge-requests/7/head → mr-7 分支）与未注册 404 覆盖。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空注册表/账户存储）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）；describe 内 afterEach vi.unstubAllGlobals
 * 撤销 fetch stub。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAccount } from '@rebased/api';
import { cleanupDirs, registerRepo, startServer, tmpDir } from './testing/integration';

let base = '';
let closeServer: () => Promise<void> = async () => {};

beforeAll(async () => {
  const started = await startServer();
  base = started.base;
  closeServer = started.close;
});

afterAll(async () => {
  await closeServer();
});

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-koa-config-');
});

afterEach(async () => {
  delete process.env.REBASED_CONFIG_DIR;
  await cleanupDirs();
});

describe('web-koa GitLab MR 域端点', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/merge-requests），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'glpat-route-test-token-1234567890';
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + gitlab.com 远程（origin = https://gitlab.com/acme/demo.git） */
  const gitlabRepo = (): { repoId: string; repoPath: string } => {
    const rig = registerRepo();
    execFileSync('git', ['-C', rig.repoPath, 'remote', 'add', 'origin', 'https://gitlab.com/acme/demo.git']);
    return rig;
  };
  /** 配置 gitlab.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  /**
   * mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止）。
   * 本测试文件自身的 HTTP 夹具也走全局 fetch → gitlab.com api 之外一律转真实 fetch（先捕获再 stub）。
   */
  const mockGitlabFetch = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const realFetch = globalThis.fetch;
    const queue = [...responses];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://gitlab.com/api/v4/')) {
        const r = queue.shift();
        if (r === undefined) throw new Error(`未预期的 GitLab API 调用：${url}`);
        return new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** mock 调用过滤：只计 GitLab API 命中（本测试文件自身夹具请求也过同一 stub） */
  const gitlabCalls = (mock: ReturnType<typeof vi.fn>): unknown[][] =>
    mock.mock.calls.filter((c) => String(c[0]).startsWith('https://gitlab.com/api/v4/'));
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
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const { repoId } = gitlabRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/status`);
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
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ detected: true, account: 'me' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/gitlab/status`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('mrs 端点：state 缺省 opened 透传（URL 与 PRIVATE-TOKEN 注入）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({ json: [mrFixture()] });
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs`);
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
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests?state=opened`);
    expect(init.headers).toMatchObject({ 'PRIVATE-TOKEN': TOKEN });
  });

  it('mrs 端点：state=merged 透传 query', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({ json: [] });
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs?state=merged`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mrs: [] });
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests?state=merged`);
  });

  it('mrs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs?state=merge`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('create 端点：POST 载荷（sourceBranch/targetBranch/title/description）与重查 detail 回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
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
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs`, {
      sourceBranch: 'feature',
      targetBranch: 'main',
      title: 'New MR',
      description: 'D',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ iid: 11, title: 'New MR', body: 'D' });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ source_branch: 'feature', target_branch: 'main', title: 'New MR', description: 'D' }),
    );
    // 重查 detail 走 GET /merge_requests/11（create 返回后）。
    expect((gitlabCalls(mock)[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/11`);
  });

  it('create 端点：缺 targetBranch（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs`, { sourceBranch: 'feature', title: 'No target' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('detail 端点：mock fetch 断言 URL 序列（MR + 尽力 reviews）与映射', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7`);
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
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7`);
    expect((gitlabCalls(mock)[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('path 参数：iid=0 / iid=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    for (const bad of ['0', 'abc']) {
      const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('timeline 端点：notes + reviews 两请求 URL 与合并升序（review id 移位）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
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
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7/timeline`);
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
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect((gitlabCalls(mock)[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('files 端点：mock fetch 断言 URL 与映射（new_path ?? old_path；旗标；diff 缺省 → 空串）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({
      json: [
        { new_path: 'a.ts', old_path: 'a.ts', diff: '@@ -1 +1 @@', new_file: false, deleted_file: false },
        { new_path: 'new.ts', old_path: null, new_file: true, deleted_file: false },
        { new_path: 'renamed.ts', old_path: 'old.ts', renamed_file: true, new_file: true, deleted_file: false },
        { new_path: null, old_path: 'del.ts', deleted_file: true, new_file: false },
        { new_path: 'm.ts', old_path: 'm.ts', new_file: false, deleted_file: false, renamed_file: false, diff: null },
      ],
    });
    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7/files`);
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
    expect((gitlabCalls(mock)[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/changes`);
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包（note + notes + reviews 三请求）', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 201, json: { id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/comments`, { body: 'new comment' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'APPROVED' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('review 端点：APPROVE → POST .../approve（无 body）与刷新详情回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 200, json: { id: 1, state: 'approved' } },
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'APPROVE', body: 'looks good' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('APPROVED');
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/approve`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('review 端点：REQUEST_CHANGES → POST .../reviews {state:rejected} 与刷新详情回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 201, json: { id: 2, state: 'rejected' } },
      { json: mrDetailFixture({ user_notes_count: 0 }) },
      {
        json: [{ id: 21, state: 'rejected', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'nope' }],
      },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'REQUEST_CHANGES', body: 'nope' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('CHANGES_REQUESTED');
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/reviews`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ state: 'rejected' }));
  });

  it('review 端点：COMMENT → POST .../notes {body} 与刷新详情回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch(
      { status: 201, json: { id: 3, body: 'need fix', author: { username: 'me' } } },
      { json: mrDetailFixture({ user_notes_count: 1 }) },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/review`, { event: 'COMMENT', body: 'need fix' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { commentsCount: number }).commentsCount).toBe(1);
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'need fix' }));
  });

  it('merge 端点：squash 类型非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitLab 请求', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch();
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/merge`, { squash: 'yes' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(gitlabCalls(mock)).toHaveLength(0);
  });

  it('merge 端点：PUT {squash:true} 载荷与回包', async () => {
    const { repoId } = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGitlabFetch({ status: 200, json: { state: 'merged', message: 'Merge request merged successfully' } });
    const res = await postJson(`/api/repos/${repoId}/gitlab/mrs/7/merge`, { squash: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Merge request merged successfully' });
    const [url, init] = gitlabCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/merge`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ squash: true }));
  });

  it('checkout 端点：真实裸仓库 refs/merge-requests/7/head → mr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-koa-gitlab-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-koa-gitlab-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'mr.txt'), 'mr-7 content');
    execFileSync('git', ['-C', other, 'add', 'mr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'mr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/merge-requests/7/head']);
    const mrHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/merge-requests/7/head'], { encoding: 'utf8' }).trim();

    const res = await fetch(`${base}/api/repos/${repoId}/gitlab/mrs/7/checkout`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'mr-7' });
    expect(execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('mr-7');
    expect(execFileSync('git', ['-C', repoPath, 'rev-parse', 'refs/heads/mr-7'], { encoding: 'utf8' }).trim()).toBe(mrHash);
    expect(execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：gitlab 全部 10 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases = [
      fetch(`${base}/api/repos/nope/gitlab/status`),
      fetch(`${base}/api/repos/nope/gitlab/mrs`),
      postJson('/api/repos/nope/gitlab/mrs', { sourceBranch: 'a', targetBranch: 'b', title: 't' }),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7`),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7/timeline`),
      postJson('/api/repos/nope/gitlab/mrs/7/comments', { body: 'x' }),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7/files`),
      postJson('/api/repos/nope/gitlab/mrs/7/review', { event: 'APPROVE' }),
      postJson('/api/repos/nope/gitlab/mrs/7/merge', { squash: true }),
      fetch(`${base}/api/repos/nope/gitlab/mrs/7/checkout`, { method: 'POST' }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
