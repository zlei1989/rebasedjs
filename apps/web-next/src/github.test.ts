/**
 * web-next GitHub PR 域路由测试：status 三态、PR 列表/详情/时间线/文件、评论、review、merge 与 checkout
 * （数据面全部 mock fetch，绝不打真实网络）。
 * 拆分自原 routes.test.ts 的 'web-next GitHub PR 域路由' describe：原单文件 194s 是测试提速瓶颈，
 * 按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAccount } from '@rebased/api';
import { GET as getGithubStatus } from '../app/api/repos/[repoId]/github/status/route';
import { GET as getGithubPrs } from '../app/api/repos/[repoId]/github/prs/route';
import { GET as getGithubPrDetail } from '../app/api/repos/[repoId]/github/prs/[number]/route';
import { GET as getGithubPrTimeline } from '../app/api/repos/[repoId]/github/prs/[number]/timeline/route';
import { POST as postGithubComment } from '../app/api/repos/[repoId]/github/prs/[number]/comments/route';
import { GET as getGithubPrFiles } from '../app/api/repos/[repoId]/github/prs/[number]/files/route';
import { POST as postGithubReview } from '../app/api/repos/[repoId]/github/prs/[number]/review/route';
import { POST as postGithubMerge } from '../app/api/repos/[repoId]/github/prs/[number]/merge/route';
import { POST as postGithubCheckout } from '../app/api/repos/[repoId]/github/prs/[number]/checkout/route';
import { cleanupTestEnv, ctx, lastRepoPath, registerRepo, setupTestEnv, tmpDir } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next GitHub PR 域路由', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/pull），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'ghp_route-test-token-1234567890';
  /** [number] 子路由 ctx：与既有 ctx 同构，多 number 路径段 */
  const numCtx = (repoId: string, number: string): { params: Promise<{ repoId: string; number: string }> } => ({
    params: Promise.resolve({ repoId, number }),
  });
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + github.com 远程（origin = https://github.com/acme/demo.git），返回 repoId */
  const githubRepo = (): string => {
    const repoId = registerRepo();
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
    return repoId;
  };
  /** 配置 github.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
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
  /** GitHub API pull JSON 夹具（toPrSummary 所需字段齐） */
  const pullFixture = (overrides: Record<string, unknown> = {}) => ({
    number: 12,
    title: 'Fix thing',
    user: { login: 'alice' },
    state: 'open',
    merged: false,
    base: { ref: 'main' },
    head: { ref: 'feature/fix' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T03:04:05Z',
    ...overrides,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 端点：无远程 → 200 {detected:false}（三态之一）', async () => {
    const repoId = registerRepo();
    const res = await getGithubStatus(new Request(`http://localhost/api/repos/${repoId}/github/status`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const repoId = githubRepo();
    const res = await getGithubStatus(new Request(`http://localhost/api/repos/${repoId}/github/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://github.com/acme/demo.git' },
    });
    expect(body.account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await getGithubStatus(new Request(`http://localhost/api/repos/${repoId}/github/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toBe(true);
    expect(body.account).toBe('me');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await getGithubStatus(new Request('http://localhost/api/repos/nope/github/status'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('prs 端点：state 缺省 open 透传（URL 与 token 注入）', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [pullFixture()] });
    const res = await getGithubPrs(new Request(`http://localhost/api/repos/${repoId}/github/prs`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prs: unknown[] }).prs).toEqual([
      expect.objectContaining({ number: 12, title: 'Fix thing', author: 'alice', state: 'open', merged: false }),
    ]);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls?state=open');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('prs 端点：state=all 透传 query', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [] });
    const res = await getGithubPrs(new Request(`http://localhost/api/repos/${repoId}/github/prs?state=all`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prs: [] });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls?state=all');
  });

  it('prs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await getGithubPrs(new Request(`http://localhost/api/repos/${repoId}/github/prs?state=merge`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('detail 端点：mock fetch 断言 URL 与映射（reviewDecision）', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({
      json: {
        ...pullFixture({ number: 7, title: 'Detail' }),
        body: 'Description',
        mergeable: true,
        review_decision: 'APPROVED',
        comments: 3,
        additions: 40,
        deletions: 12,
      },
    });
    const res = await getGithubPrDetail(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7`),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      number: 7,
      title: 'Detail',
      author: 'alice',
      body: 'Description',
      mergeable: true,
      reviewDecision: 'APPROVED',
      commentsCount: 3,
      additions: 40,
      deletions: 12,
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7');
  });

  it('path 参数：number=0 / number=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    for (const bad of ['0', 'abc']) {
      const res = await getGithubPrDetail(
        new Request(`http://localhost/api/repos/${repoId}/github/prs/${bad}`),
        numCtx(repoId, bad),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('timeline 端点：comments + reviews 两请求 URL 与合并升序', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { json: [{ id: 5, user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' }] },
      {
        json: [{ id: 12, user: { login: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'needs work', state: 'CHANGES_REQUESTED' }],
      },
    );
    const res = await getGithubPrTimeline(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7/timeline`),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
        {
          id: 1000000012,
          author: 'carol',
          atIso: '2026-01-02T00:00:00Z',
          body: 'needs work',
          kind: 'review',
          reviewState: 'CHANGES_REQUESTED',
        },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect((mock.mock.calls[1] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
  });

  it('files 端点：mock fetch 断言 URL 与映射（patch 缺省 → 空串）', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({
      json: [
        { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { filename: 'new.ts', status: 'added', additions: 5, deletions: 0 },
      ],
    });
    const res = await getGithubPrFiles(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7/files`),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 5, deletions: 0, patch: '' },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/files');
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postGithubComment(
      jsonPost(`${repoId}/github/prs/7/comments`, { body: 'new comment' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGithubReview(
      jsonPost(`${repoId}/github/prs/7/review`, { event: 'APPROVED' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('review 端点：POST 载荷 {event, body} 与刷新详情回包', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      {
        status: 201,
        json: { id: 21, state: 'APPROVED', user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'looks good' },
      },
      {
        json: {
          ...pullFixture({ number: 7 }),
          body: 'b',
          mergeable: true,
          review_decision: 'APPROVED',
          comments: 1,
          additions: 1,
          deletions: 0,
        },
      },
    );
    const res = await postGithubReview(
      jsonPost(`${repoId}/github/prs/7/review`, { event: 'APPROVE', body: 'looks good' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewDecision: string }).reviewDecision).toBe('APPROVED');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ event: 'APPROVE', body: 'looks good' }));
  });

  it('merge 端点：method 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGithubMerge(
      jsonPost(`${repoId}/github/prs/7/merge`, { method: 'ff' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('merge 端点：POST {merge_method} 载荷与回包', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ status: 200, json: { merged: true, message: 'Pull Request successfully merged' } });
    const res = await postGithubMerge(
      jsonPost(`${repoId}/github/prs/7/merge`, { method: 'squash' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Pull Request successfully merged' });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/merge');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ merge_method: 'squash' }));
  });

  it('checkout 端点：真实裸仓库 refs/pull/7/head → pr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-next-github-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-next-github-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'pr.txt'), 'pr-7 content');
    execFileSync('git', ['-C', other, 'add', 'pr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'pr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head']);
    const prHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/pull/7/head'], { encoding: 'utf8' }).trim();

    const res = await postGithubCheckout(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7/checkout`, { method: 'POST' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'pr-7' });
    expect(execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('pr-7');
    expect(execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'refs/heads/pr-7'], { encoding: 'utf8' }).trim()).toBe(prHash);
    expect(execFileSync('git', ['-C', lastRepoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：github 全部 9 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getGithubStatus(new Request('http://localhost/api/repos/nope/github/status'), ctx('nope')),
      getGithubPrs(new Request('http://localhost/api/repos/nope/github/prs'), ctx('nope')),
      getGithubPrDetail(new Request('http://localhost/api/repos/nope/github/prs/7'), numCtx('nope', '7')),
      getGithubPrTimeline(new Request('http://localhost/api/repos/nope/github/prs/7/timeline'), numCtx('nope', '7')),
      postGithubComment(jsonPost('nope/github/prs/7/comments', { body: 'x' }), numCtx('nope', '7')),
      getGithubPrFiles(new Request('http://localhost/api/repos/nope/github/prs/7/files'), numCtx('nope', '7')),
      postGithubReview(jsonPost('nope/github/prs/7/review', { event: 'APPROVE' }), numCtx('nope', '7')),
      postGithubMerge(jsonPost('nope/github/prs/7/merge', { method: 'merge' }), numCtx('nope', '7')),
      postGithubCheckout(new Request('http://localhost/api/repos/nope/github/prs/7/checkout', { method: 'POST' }), numCtx('nope', '7')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
