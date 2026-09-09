import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addGithubPrComment,
  addGithubPrReviewComment,
  checkoutGithubPr,
  getGithubPrDetail,
  getGithubPrFiles,
  getGithubPrReviewComments,
  getGithubPrs,
  getGithubPrTimeline,
  getGithubStatus,
  mergeGithubPr,
  parseGithubRemoteUrl,
  submitGithubPrReview,
} from './github';
import { upsertAccount } from './auth';
import { loadConfig, saveConfig } from './lib/config-store';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];
/** 测试令牌：用于断言请求头注入与「错误消息/响应绝不含 token」 */
const TOKEN = 'ghp_s3cret-token-1234567890';

beforeAll(() => {
  process.env.REBASED_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rebased-github-'));
});

/** 每用例清空账户簿记：token 存在性测试互不污染 */
beforeEach(() => {
  const config = loadConfig();
  config.auth = { accounts: [] };
  saveConfig(config);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 临时仓库 + 单个远程（无提交，足够数据面/status 测试使用） */
function repoWithRemote(url: string, name = 'origin'): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  git(repo, ['remote', 'add', name, url]);
  return repo;
}

/** 捕获拒绝并返回原始错误（token 下发断言用） */
async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('预期 reject 但成功返回');
}

/** mock 全局 fetch：按序返回给定响应（JSON 序列化），记录调用供 URL/headers 断言 */
type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
function mockFetchSequence(...responses: FakeResponse[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(
      new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers }),
    );
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('parseGithubRemoteUrl', () => {
  it('https 形态：可选 .git 与尾斜杠', () => {
    expect(parseGithubRemoteUrl('https://github.com/acme/demo.git')).toEqual({
      owner: 'acme',
      name: 'demo',
      remoteUrl: 'https://github.com/acme/demo.git',
    });
    expect(parseGithubRemoteUrl('https://github.com/acme/demo')?.name).toBe('demo');
    expect(parseGithubRemoteUrl('https://github.com/acme/demo/')?.name).toBe('demo');
    expect(parseGithubRemoteUrl('https://github.com/acme/demo.git/')?.name).toBe('demo');
    expect(parseGithubRemoteUrl('https://github.com/acme/demo_repo.v2-x')?.name).toBe('demo_repo.v2-x');
  });

  it('SSH 形态 git@github.com:{owner}/{repo}[.git]', () => {
    expect(parseGithubRemoteUrl('git@github.com:acme/demo.git')).toEqual({
      owner: 'acme',
      name: 'demo',
      remoteUrl: 'git@github.com:acme/demo.git',
    });
    expect(parseGithubRemoteUrl('git@github.com:acme/demo')?.name).toBe('demo');
  });

  it('非 github 域名 / gist 子域 / 用户名 / 端口 / 子路径 / local 路径 → null', () => {
    expect(parseGithubRemoteUrl('https://gitlab.com/acme/demo.git')).toBeNull();
    expect(parseGithubRemoteUrl('git@gitlab.com:acme/demo.git')).toBeNull();
    // gist.github.com 是 github.com 子域但不属于仓库 PR 域（裁定除外）
    expect(parseGithubRemoteUrl('https://gist.github.com/acme/1234.git')).toBeNull();
    expect(parseGithubRemoteUrl('git@gist.github.com:acme/1234.git')).toBeNull();
    expect(parseGithubRemoteUrl('https://user@github.com/acme/demo.git')).toBeNull();
    expect(parseGithubRemoteUrl('https://github.com:8080/acme/demo.git')).toBeNull();
    expect(parseGithubRemoteUrl('https://github.com/acme/demo/extra')).toBeNull();
    expect(parseGithubRemoteUrl('https://github.com/acme/demo.git/extra')).toBeNull();
    expect(parseGithubRemoteUrl('https://github.com/acme')).toBeNull();
    expect(parseGithubRemoteUrl('https://github.com/')).toBeNull();
    expect(parseGithubRemoteUrl('ssh://git@github.com/acme/demo.git')).toBeNull();
    expect(parseGithubRemoteUrl('acme/demo')).toBeNull();
    expect(parseGithubRemoteUrl('/srv/git/demo.git')).toBeNull();
    expect(parseGithubRemoteUrl('C:\\work\\demo')).toBeNull();
  });
});

describe('getGithubStatus（不抛错）', () => {
  it('https 远程 → detected true + repo（owner/name 解析）', async () => {
    const status = await getGithubStatus(repoWithRemote('https://github.com/acme/demo.git'));
    expect(status.detected).toBe(true);
    expect(status.repo).toEqual({ owner: 'acme', name: 'demo', remoteUrl: 'https://github.com/acme/demo.git' });
  });

  it('SSH 远程 → detected true', async () => {
    const status = await getGithubStatus(repoWithRemote('git@github.com:acme/demo.git'));
    expect(status.detected).toBe(true);
    expect(status.repo?.owner).toBe('acme');
    expect(status.repo?.name).toBe('demo');
  });

  it('gitlab 远程 → detected false', async () => {
    const status = await getGithubStatus(repoWithRemote('https://gitlab.com/acme/demo.git'));
    expect(status).toEqual({ detected: false });
  });

  it('无远程 → detected false', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const status = await getGithubStatus(repo);
    expect(status).toEqual({ detected: false });
  });

  it('非 git 目录 → detected false（不抛错）', async () => {
    const status = await getGithubStatus(createTmpDir('rebased-github-plain-'));
    expect(status).toEqual({ detected: false });
  });

  it('有远程无令牌 → account undefined；响应不含 token', async () => {
    const repo = repoWithRemote('https://github.com/acme/demo.git');
    const status = await getGithubStatus(repo);
    expect(status.detected).toBe(true);
    expect(status.account).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it('配置 github.com 账户 → account 返回账户名且响应不含 token', async () => {
    upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
    const status = await getGithubStatus(repoWithRemote('https://github.com/acme/demo.git'));
    expect(status.detected).toBe(true);
    expect(status.account).toBe('me');
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });
});

describe('数据面：无远程 / 无令牌前置校验', () => {
  it('无远程 → INVALID_QUERY 仓库未检测到 GitHub 远程', async () => {
    const err = await captureError(getGithubPrs(createTmpRepo(), 'open'));
    expect(err).toMatchObject({ code: 'INVALID_QUERY', message: '仓库未检测到 GitHub 远程' });
  });

  it('有 GitHub 远程但无令牌 → AUTH_FAILED 且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await captureError(getGithubPrs(repoWithRemote('https://github.com/acme/demo.git'), 'open'));
    expect(err).toMatchObject({ code: 'AUTH_FAILED', message: '未配置 GitHub 令牌，请在设置中添加' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('githubRequest：URL/headers 契约与 GET 映射', () => {
  function authedRepo(): string {
    upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://github.com/acme/demo.git');
  }

  it('getGithubPrs：GET /pulls?state=open，headers 精确注入，字段映射', async () => {
    const fetchMock = mockFetchSequence({
      json: [
        {
          number: 12,
          title: 'Fix thing',
          user: { login: 'alice' },
          state: 'open',
          merged: false,
          base: { ref: 'main' },
          head: { ref: 'feature/fix' },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T03:04:05Z',
        },
        {
          number: 9,
          title: 'Closed one',
          user: { login: 'bob' },
          state: 'closed',
          merged: true,
          base: { ref: 'main' },
          head: { ref: 'feature/old' },
          created_at: '2025-12-01T00:00:00Z',
          updated_at: '2025-12-03T00:00:00Z',
        },
      ],
    });
    const res = await getGithubPrs(authedRepo(), 'open');
    expect(res.prs).toEqual([
      {
        number: 12,
        title: 'Fix thing',
        author: 'alice',
        state: 'open',
        merged: false,
        baseRef: 'main',
        headRef: 'feature/fix',
        createdAtIso: '2026-01-01T00:00:00Z',
        updatedAtIso: '2026-01-02T03:04:05Z',
      },
      {
        number: 9,
        title: 'Closed one',
        author: 'bob',
        state: 'closed',
        merged: true,
        baseRef: 'main',
        headRef: 'feature/old',
        createdAtIso: '2025-12-01T00:00:00Z',
        updatedAtIso: '2025-12-03T00:00:00Z',
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls?state=open');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rebasedjs',
    });
  });

  it('getGithubPrs：state=all 透传 query', async () => {
    const fetchMock = mockFetchSequence({ json: [] });
    await getGithubPrs(authedRepo(), 'all');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls?state=all');
  });

  it('getGithubPrDetail：GET /pulls/7，mergeable null → false，review_decision REVIEW_REQUIRED', async () => {
    const fetchMock = mockFetchSequence({
      json: {
        number: 7,
        title: 'Detail',
        user: { login: 'carol' },
        state: 'open',
        merged: false,
        base: { ref: 'main' },
        head: { ref: 'fix' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        body: 'Description',
        mergeable: null,
        review_decision: 'REVIEW_REQUIRED',
        comments: 3,
        additions: 40,
        deletions: 12,
      },
    });
    const detail = await getGithubPrDetail(authedRepo(), 7);
    expect(detail).toEqual({
      number: 7,
      title: 'Detail',
      author: 'carol',
      state: 'open',
      merged: false,
      baseRef: 'main',
      headRef: 'fix',
      createdAtIso: '2026-01-01T00:00:00Z',
      updatedAtIso: '2026-01-02T00:00:00Z',
      body: 'Description',
      mergeable: false,
      reviewDecision: 'REVIEW_REQUIRED',
      commentsCount: 3,
      additions: 40,
      deletions: 12,
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7');
  });

  it('getGithubPrDetail：review_decision null → NONE；body null → 空串', async () => {
    mockFetchSequence({
      json: {
        number: 1,
        title: 'T',
        user: { login: 'u' },
        state: 'open',
        merged: false,
        base: { ref: 'b' },
        head: { ref: 'h' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        body: null,
        mergeable: true,
        review_decision: null,
        comments: 0,
        additions: 1,
        deletions: 2,
      },
    });
    const detail = await getGithubPrDetail(authedRepo(), 1);
    expect(detail.reviewDecision).toBe('NONE');
    expect(detail.mergeable).toBe(true);
    expect(detail.body).toBe('');
  });

  it('getGithubPrFiles：patch 缺省 → 空串；状态映射', async () => {
    const fetchMock = mockFetchSequence({
      json: [
        { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { filename: 'new.ts', status: 'added', additions: 5, deletions: 0 },
      ],
    });
    const res = await getGithubPrFiles(authedRepo(), 7);
    expect(res.files).toEqual([
      { path: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
      { path: 'new.ts', status: 'added', additions: 5, deletions: 0, patch: '' },
    ]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/files');
  });
});

describe('githubRequest：错误映射与 token 不下发', () => {
  function authedRepo(): string {
    upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://github.com/acme/demo.git');
  }

  it.each([
    [{ status: 401, json: { message: 'Bad credentials' } }, 'AUTH_FAILED', 'GitHub 认证失败：Bad credentials'],
    [{ status: 403, json: { message: 'Forbidden' } }, 'AUTH_FAILED', 'GitHub 认证失败：Forbidden'],
    [{ status: 404, json: { message: 'Not Found' } }, 'INVALID_REF', 'PR 不存在或无权访问：Not Found'],
    [{ status: 500, json: { message: 'Internal Server Error' } }, 'GIT_ERROR', 'GitHub API 请求失败：500 Internal Server Error'],
    [{ status: 422, json: { message: 'Validation Failed' } }, 'GIT_ERROR', 'GitHub API 请求失败：422 Validation Failed'],
  ])('%j → %s', async (response, code, message) => {
    mockFetchSequence(response as FakeResponse);
    const err = await captureError(getGithubPrs(authedRepo(), 'open'));
    expect(err).toMatchObject({ code, message });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('403 且消息含 rate limit → RATE_LIMITED', async () => {
    mockFetchSequence({ status: 403, json: { message: 'API rate limit exceeded for 1.2.3.4' } });
    const err = await captureError(getGithubPrs(authedRepo(), 'open'));
    expect(err).toMatchObject({ code: 'RATE_LIMITED', message: 'GitHub API 限流：API rate limit exceeded for 1.2.3.4' });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('429 → RATE_LIMITED', async () => {
    mockFetchSequence({ status: 429, json: { message: 'API rate limit exceeded' } });
    const err = await captureError(getGithubPrs(authedRepo(), 'open'));
    expect(err).toMatchObject({ code: 'RATE_LIMITED', message: 'GitHub API 限流：API rate limit exceeded' });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('响应头 X-RateLimit-Remaining: 0（非 4xx）→ RATE_LIMITED', async () => {
    mockFetchSequence({ status: 200, json: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } });
    const err = await captureError(getGithubPrs(authedRepo(), 'open'));
    expect(err).toMatchObject({ code: 'RATE_LIMITED', message: 'GitHub API 限流：API rate limit exceeded' });
  });

  it('fetch 网络异常（TypeError）→ GIT_ERROR，消息不含 token', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fn);
    const err = await captureError(getGithubPrs(authedRepo(), 'open'));
    expect(err).toMatchObject({ code: 'GIT_ERROR', message: expect.stringContaining('GitHub API 请求失败：') });
    expect((err as { message: string }).message).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });
});

describe('时间线：comments + reviews 合并升序，review id 移位', () => {
  it('按 created_at 升序合并；kind/reviewState 映射；review id = 1000000000 + reviewId', async () => {
    upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
    const repo = repoWithRemote('https://github.com/acme/demo.git');
    const fetchMock = mockFetchSequence(
      {
        json: [
          { id: 5, user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' },
          { id: 6, user: { login: 'bob' }, created_at: '2026-01-03T00:00:00Z', body: 'comment 3' },
        ],
      },
      {
        json: [
          { id: 12, user: { login: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'needs work', state: 'CHANGES_REQUESTED' },
          { id: 13, user: { login: 'dave' }, created_at: '2026-01-04T00:00:00Z', body: 'lgtm', state: 'APPROVED' },
          { id: 14, user: { login: 'erin' }, created_at: '2026-01-05T00:00:00Z', body: 'hmm', state: 'DISMISSED' },
        ],
      },
    );
    const timeline = await getGithubPrTimeline(repo, 7);
    expect(timeline.entries).toEqual([
      { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
      { id: 1000000012, author: 'carol', atIso: '2026-01-02T00:00:00Z', body: 'needs work', kind: 'review', reviewState: 'CHANGES_REQUESTED' },
      { id: 6, author: 'bob', atIso: '2026-01-03T00:00:00Z', body: 'comment 3', kind: 'comment' },
      { id: 1000000013, author: 'dave', atIso: '2026-01-04T00:00:00Z', body: 'lgtm', kind: 'review', reviewState: 'APPROVED' },
      // DISMISSED 不在三态内 → COMMENTED（裁定：非 APPROVED/CHANGES_REQUESTED 一律 COMMENTED）
      { id: 1000000014, author: 'erin', atIso: '2026-01-05T00:00:00Z', body: 'hmm', kind: 'review', reviewState: 'COMMENTED' },
    ]);
    expect(new Set(timeline.entries.map((e) => e.id)).size).toBe(timeline.entries.length);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
  });

  it('空 reviews → 只有 comments', async () => {
    upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
    const repo = repoWithRemote('https://github.com/acme/demo.git');
    mockFetchSequence({ json: [{ id: 1, user: { login: 'x' }, created_at: '2026-01-01T00:00:00Z', body: null }] }, { json: [] });
    const timeline = await getGithubPrTimeline(repo, 7);
    expect(timeline.entries).toEqual([{ id: 1, author: 'x', atIso: '2026-01-01T00:00:00Z', body: '', kind: 'comment' }]);
  });
});

describe('写操作：POST body/方法契约', () => {
  function authedRepo(): string {
    upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://github.com/acme/demo.git');
  }

  it('addGithubPrComment：POST /issues/{n}/comments 带 JSON body，返回刷新时间线', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 201, json: { id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const timeline = await addGithubPrComment(repo, 7, 'new comment');
    expect(timeline.entries).toEqual([{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('submitGithubPrReview：POST /pulls/{n}/reviews {event, body}，返回刷新详情', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 201, json: { id: 21, state: 'APPROVED', user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'looks good' } },
      {
        json: {
          number: 7,
          title: 'Detail',
          user: { login: 'x' },
          state: 'open',
          merged: false,
          base: { ref: 'main' },
          head: { ref: 'fix' },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          body: 'b',
          mergeable: true,
          review_decision: 'APPROVED',
          comments: 1,
          additions: 1,
          deletions: 0,
        },
      },
    );
    const detail = await submitGithubPrReview(repo, 7, { event: 'APPROVE', body: 'looks good' });
    expect(detail.reviewDecision).toBe('APPROVED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ event: 'APPROVE', body: 'looks good' }));
  });

  it('mergeGithubPr：POST /pulls/{n}/merge {merge_method}', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence({ status: 200, json: { merged: true, message: 'Pull Request successfully merged' } });
    const res = await mergeGithubPr(repo, 7, { method: 'squash' });
    expect(res).toEqual({ merged: true, message: 'Pull Request successfully merged' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/merge');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ merge_method: 'squash' }));
  });
});

describe('行级评审评论（review-comments）', () => {
  it('getGithubPrReviewComments：GET /pulls/{n}/comments 映射（line 兜底 original_line、side 原样）', async () => {
    const repo = repoWithRemote('https://github.com/acme/demo.git');
    await upsertAccount({ host: 'github.com', account: 'alice', token: TOKEN });
    const fetchMock = mockFetchSequence({
      json: [
        { id: 1, path: 'src/a.ts', line: 3, original_line: null, side: 'RIGHT', user: { login: 'bob' }, created_at: '2026-07-01T08:30:00Z', body: '这里需要修正' },
        { id: 2, path: 'src/a.ts', line: null, original_line: 4, side: 'LEFT', user: { login: 'carol' }, created_at: '2026-07-02T09:00:00Z', body: '旧侧评论' },
      ],
    });

    const result = await getGithubPrReviewComments(repo, 7);

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/comments');
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toEqual({
      id: 1, path: 'src/a.ts', line: 3, side: 'RIGHT', author: 'bob', atIso: '2026-07-01T08:30:00Z', body: '这里需要修正',
    });
    // 旧侧评论：line 兜底 original_line
    expect(result.comments[1]).toMatchObject({ line: 4, side: 'LEFT', author: 'carol' });
  });

  it('addGithubPrReviewComment：POST /pulls/{n}/comments 带 {path,line,side,body}，返回刷新列表', async () => {
    const repo = repoWithRemote('https://github.com/acme/demo.git');
    await upsertAccount({ host: 'github.com', account: 'alice', token: TOKEN });
    const fetchMock = mockFetchSequence(
      { json: { id: 9, path: 'src/a.ts', line: 3, original_line: null, side: 'RIGHT', user: { login: 'alice' }, created_at: '2026-07-03T10:00:00Z', body: 'ok' } },
      { json: [{ id: 9, path: 'src/a.ts', line: 3, original_line: null, side: 'RIGHT', user: { login: 'alice' }, created_at: '2026-07-03T10:00:00Z', body: 'ok' }] },
    );

    const result = await addGithubPrReviewComment(repo, 7, { path: 'src/a.ts', line: 3, side: 'RIGHT', body: 'ok' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/comments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ path: 'src/a.ts', line: 3, side: 'RIGHT', body: 'ok' });
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].id).toBe(9);
  });
});

describe('checkoutGithubPr（真实临时仓库 + 裸仓库装置）', () => {
  const RIG_TIMEOUT = 120000;

  /** origin（或指定名）指向裸仓库；裸仓库含 refs/pull/7/head（独立提交） */
  function makeCheckoutRig(remoteName = 'origin'): { repo: string; bare: string; defaultBranch: string; prHash: string } {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    writeFileSync(join(repo, 'a.txt'), 'base');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);
    const bare = createTmpDir('rebased-github-bare-');
    dirs.push(bare);
    execFileSync('git', ['init', '-q', '--bare', bare]);
    git(repo, ['remote', 'add', remoteName, bare]);
    git(repo, ['push', '-q', '-u', remoteName, defaultBranch]);
    const other = createTmpDir('rebased-github-other-');
    dirs.push(other);
    execFileSync('git', ['clone', '-q', bare, other]);
    git(other, ['config', 'user.email', 'test@example.com']);
    git(other, ['config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'pr.txt'), 'pr-7 content');
    git(other, ['add', 'pr.txt']);
    git(other, ['commit', '-q', '-m', 'pr 7 commit']);
    git(other, ['push', '-q', 'origin', 'HEAD:refs/pull/7/head']);
    const prHash = git(bare, ['rev-parse', 'refs/pull/7/head']);
    return { repo, bare, defaultBranch, prHash };
  }

  it('fetch refs/pull/7/head + checkoutNewBranch pr-7：分支建立并已检出', { timeout: RIG_TIMEOUT }, async () => {
    const { repo, prHash } = makeCheckoutRig();
    const res = await checkoutGithubPr(repo, 7);
    expect(res).toEqual({ branchName: 'pr-7' });
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('pr-7');
    expect(git(repo, ['rev-parse', '--verify', 'refs/heads/pr-7'])).toBe(prHash);
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(prHash);
    // 工作区干净（pr-7 内容已检出而非仅分支引用）
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('分支已存在 → 仅 checkout（不 fetch：origin 指向不存在路径）', { timeout: RIG_TIMEOUT }, async () => {
    const { repo } = makeCheckoutRig();
    git(repo, ['branch', 'pr-7']);
    const base = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['remote', 'set-url', 'origin', join(tmpdir(), 'rebased-github-nowhere')]);
    const res = await checkoutGithubPr(repo, 7);
    expect(res).toEqual({ branchName: 'pr-7' });
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(base);
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('pr-7');
  });

  it('无 origin 取第一个远程', { timeout: RIG_TIMEOUT }, async () => {
    const { repo, prHash } = makeCheckoutRig('upstream');
    const res = await checkoutGithubPr(repo, 7);
    expect(res).toEqual({ branchName: 'pr-7' });
    expect(git(repo, ['rev-parse', '--verify', 'refs/heads/pr-7'])).toBe(prHash);
  });

  it('无远程 → INVALID_QUERY 未检测到远程', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const err = await captureError(checkoutGithubPr(repo, 7));
    expect(err).toMatchObject({ code: 'INVALID_QUERY', message: '未检测到远程' });
  });

  it('fetch 失败 → GIT_ERROR（中文消息 + stderr 首行）', { timeout: RIG_TIMEOUT }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'base');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);
    git(repo, ['remote', 'add', 'origin', join(tmpdir(), 'rebased-github-nowhere')]);
    const err = await captureError(checkoutGithubPr(repo, 7));
    expect(err).toMatchObject({
      code: 'GIT_ERROR',
      message: expect.stringContaining('GitHub PR 拉取失败：'),
    });
    expect((err as { message: string }).message).toContain('does not appear to be a git repository');
    expect((err as { message: string }).message).not.toContain(TOKEN);
  });
});
