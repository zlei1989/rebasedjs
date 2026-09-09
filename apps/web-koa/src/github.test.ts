/**
 * web-koa GitHub PR 域端点集成测试（拆分自 app.test.ts）。
 * 职责：github/status（三态检测）、prs 列表/detail/timeline/files/comments/review/merge 数据面路由
 * （mock 全局 fetch 断言 URL、token 注入与字段映射，绝不打真实网络）、checkout（真实裸仓库
 * refs/pull/7/head → pr-7 分支）与未注册 404 覆盖。
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

describe('web-koa GitHub PR 域端点', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/pull），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'ghp_route-test-token-1234567890';
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + github.com 远程（origin = https://github.com/acme/demo.git） */
  const githubRepo = (): { repoId: string; repoPath: string } => {
    const rig = registerRepo();
    execFileSync('git', ['-C', rig.repoPath, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
    return rig;
  };
  /** 配置 github.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  /**
   * mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止）。
   * 本测试文件自身的 HTTP 夹具也走全局 fetch → api.github.com 之外一律转真实 fetch（先捕获再 stub）。
   */
  const mockGithubFetch = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const realFetch = globalThis.fetch;
    const queue = [...responses];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/')) {
        const r = queue.shift();
        if (r === undefined) throw new Error(`未预期的 GitHub API 调用：${url}`);
        return new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** mock 调用过滤：只计 GitHub API 命中（本测试文件自身夹具请求也过同一 stub） */
  const githubCalls = (mock: ReturnType<typeof vi.fn>): unknown[][] =>
    mock.mock.calls.filter((c) => String(c[0]).startsWith('https://api.github.com/'));
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
    const { repoId } = registerRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/github/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const { repoId } = githubRepo();
    const res = await fetch(`${base}/api/repos/${repoId}/github/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://github.com/acme/demo.git' },
    });
    expect((body as { account?: string }).account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await fetch(`${base}/api/repos/${repoId}/github/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ detected: true, account: 'me' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await fetch(`${base}/api/repos/nope/github/status`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('prs 端点：state 缺省 open 透传（URL 与 token 注入）', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({ json: [pullFixture()] });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prs: unknown[] }).prs).toHaveLength(1);
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls?state=open');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('prs 端点：state=all 透传 query', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({ json: [] });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs?state=all`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prs: [] });
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls?state=all');
  });

  it('prs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs?state=merge`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('detail 端点：mock fetch 断言 URL 与映射（reviewDecision）', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({
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
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7`);
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
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7');
  });

  it('path 参数：number=0 / number=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    for (const bad of ['0', 'abc']) {
      const res = await fetch(`${base}/api/repos/${repoId}/github/prs/${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('timeline 端点：comments + reviews 两请求 URL 与合并升序', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch(
      { json: [{ id: 5, user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' }] },
      {
        json: [{ id: 12, user: { login: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'needs work', state: 'CHANGES_REQUESTED' }],
      },
    );
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7/timeline`);
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
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect((githubCalls(mock)[1] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
  });

  it('files 端点：mock fetch 断言 URL 与映射（patch 缺省 → 空串）', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({
      json: [
        { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { filename: 'new.ts', status: 'added', additions: 5, deletions: 0 },
      ],
    });
    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7/files`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 5, deletions: 0, patch: '' },
      ],
    });
    expect((githubCalls(mock)[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/files');
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch(
      { status: 201, json: { id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/comments`, { body: 'new comment' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/review`, { event: 'APPROVED' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('review 端点：POST 载荷 {event, body} 与刷新详情回包', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch(
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
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/review`, { event: 'APPROVE', body: 'looks good' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewDecision: string }).reviewDecision).toBe('APPROVED');
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ event: 'APPROVE', body: 'looks good' }));
  });

  it('merge 端点：method 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起 GitHub 请求', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch();
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/merge`, { method: 'ff' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(githubCalls(mock)).toHaveLength(0);
  });

  it('merge 端点：POST {merge_method} 载荷与回包', async () => {
    const { repoId } = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockGithubFetch({ status: 200, json: { merged: true, message: 'Pull Request successfully merged' } });
    const res = await postJson(`/api/repos/${repoId}/github/prs/7/merge`, { method: 'squash' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Pull Request successfully merged' });
    const [url, init] = githubCalls(mock)[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/merge');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ merge_method: 'squash' }));
  });

  it('checkout 端点：真实裸仓库 refs/pull/7/head → pr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-koa-github-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-koa-github-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'pr.txt'), 'pr-7 content');
    execFileSync('git', ['-C', other, 'add', 'pr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'pr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head']);
    const prHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/pull/7/head'], { encoding: 'utf8' }).trim();

    const res = await fetch(`${base}/api/repos/${repoId}/github/prs/7/checkout`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'pr-7' });
    expect(execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('pr-7');
    expect(execFileSync('git', ['-C', repoPath, 'rev-parse', 'refs/heads/pr-7'], { encoding: 'utf8' }).trim()).toBe(prHash);
    expect(execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：github 全部 9 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases = [
      fetch(`${base}/api/repos/nope/github/status`),
      fetch(`${base}/api/repos/nope/github/prs`),
      fetch(`${base}/api/repos/nope/github/prs/7`),
      fetch(`${base}/api/repos/nope/github/prs/7/timeline`),
      postJson('/api/repos/nope/github/prs/7/comments', { body: 'x' }),
      fetch(`${base}/api/repos/nope/github/prs/7/files`),
      postJson('/api/repos/nope/github/prs/7/review', { event: 'APPROVE' }),
      postJson('/api/repos/nope/github/prs/7/merge', { method: 'merge' }),
      fetch(`${base}/api/repos/nope/github/prs/7/checkout`, { method: 'POST' }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
