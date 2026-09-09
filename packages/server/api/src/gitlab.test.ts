import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addGitlabMrComment,
  addGitlabMrDiscussion,
  checkoutGitlabMr,
  createGitlabMr,
  getGitlabMrDetail,
  getGitlabMrDiscussions,
  getGitlabMrFiles,
  getGitlabMrs,
  getGitlabMrTimeline,
  getGitlabStatus,
  mergeGitlabMr,
  parseGitlabRemoteUrl,
  submitGitlabMrReview,
} from './gitlab';
import { upsertAccount } from './auth';
import { loadConfig, saveConfig } from './lib/config-store';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];
/** 测试令牌：用于断言请求头注入与「错误消息/响应绝不含 token」 */
const TOKEN = 'glpat-s3cret-token-1234567890';

beforeAll(() => {
  process.env.REBASED_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rebased-gitlab-'));
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

describe('parseGitlabRemoteUrl', () => {
  it('https 形态：多级 owner（含子组）、可选 .git 与尾斜杠', () => {
    expect(parseGitlabRemoteUrl('https://gitlab.com/acme/demo.git')).toEqual({
      owner: 'acme',
      name: 'demo',
      remoteUrl: 'https://gitlab.com/acme/demo.git',
    });
    expect(parseGitlabRemoteUrl('https://gitlab.com/g/s/repo.git')).toEqual({
      owner: 'g/s',
      name: 'repo',
      remoteUrl: 'https://gitlab.com/g/s/repo.git',
    });
    expect(parseGitlabRemoteUrl('https://gitlab.com/g/s/repo')?.owner).toBe('g/s');
    expect(parseGitlabRemoteUrl('https://gitlab.com/g/s/repo/')?.owner).toBe('g/s');
    expect(parseGitlabRemoteUrl('https://gitlab.com/g/s/repo.git/')?.owner).toBe('g/s');
    expect(parseGitlabRemoteUrl('https://gitlab.com/acme/demo_repo.v2-x')?.name).toBe('demo_repo.v2-x');
  });

  it('SSH 形态 git@gitlab.com:{group[/sub]}/{repo}[.git]（多级 owner）', () => {
    expect(parseGitlabRemoteUrl('git@gitlab.com:acme/demo.git')).toEqual({
      owner: 'acme',
      name: 'demo',
      remoteUrl: 'git@gitlab.com:acme/demo.git',
    });
    expect(parseGitlabRemoteUrl('git@gitlab.com:g/s/repo.git')?.owner).toBe('g/s');
    expect(parseGitlabRemoteUrl('git@gitlab.com:g/s/repo')?.name).toBe('repo');
  });

  it('非 gitlab.com 域 / 用户名 / 端口 / 子路径 / 本地路径 → null', () => {
    expect(parseGitlabRemoteUrl('https://github.com/acme/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('git@github.com:acme/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('https://gitlab.example.com/acme/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('git@gitlab.example.com:acme/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('https://user@gitlab.com/acme/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('https://gitlab.com:8080/acme/demo.git')).toBeNull();
    // 多级 owner 裁定：深层路径按子组语义解析（acme/demo 为组，extra 为仓库）
    expect(parseGitlabRemoteUrl('https://gitlab.com/acme/demo/extra')).toEqual({
      owner: 'acme/demo',
      name: 'extra',
      remoteUrl: 'https://gitlab.com/acme/demo/extra',
    });
    // owner 段不得以 .git 结尾（GitLab 保留）：demo.git/extra 非项目路径
    expect(parseGitlabRemoteUrl('https://gitlab.com/acme/demo.git/extra')).toBeNull();
    expect(parseGitlabRemoteUrl('https://gitlab.com/acme')).toBeNull();
    expect(parseGitlabRemoteUrl('https://gitlab.com/')).toBeNull();
    expect(parseGitlabRemoteUrl('ssh://git@gitlab.com/acme/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('acme/demo')).toBeNull();
    expect(parseGitlabRemoteUrl('/srv/git/demo.git')).toBeNull();
    expect(parseGitlabRemoteUrl('C:\\work\\demo')).toBeNull();
  });
});

describe('getGitlabStatus（不抛错）', () => {
  it('https 远程（含子组）→ detected true + repo（owner 为全路径）', async () => {
    const status = await getGitlabStatus(repoWithRemote('https://gitlab.com/g/s/demo.git'));
    expect(status.detected).toBe(true);
    expect(status.repo).toEqual({ owner: 'g/s', name: 'demo', remoteUrl: 'https://gitlab.com/g/s/demo.git' });
  });

  it('SSH 远程 → detected true', async () => {
    const status = await getGitlabStatus(repoWithRemote('git@gitlab.com:g/s/demo.git'));
    expect(status.detected).toBe(true);
    expect(status.repo?.owner).toBe('g/s');
    expect(status.repo?.name).toBe('demo');
  });

  it('github 远程 → detected false', async () => {
    const status = await getGitlabStatus(repoWithRemote('https://github.com/acme/demo.git'));
    expect(status).toEqual({ detected: false });
  });

  it('无远程 → detected false', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const status = await getGitlabStatus(repo);
    expect(status).toEqual({ detected: false });
  });

  it('非 git 目录 → detected false（不抛错）', async () => {
    const status = await getGitlabStatus(createTmpDir('rebased-gitlab-plain-'));
    expect(status).toEqual({ detected: false });
  });

  it('有远程无令牌 → account undefined；响应不含 token', async () => {
    const repo = repoWithRemote('https://gitlab.com/acme/demo.git');
    const status = await getGitlabStatus(repo);
    expect(status.detected).toBe(true);
    expect(status.account).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it('配置 gitlab.com 账户 → account 返回账户名且响应不含 token', async () => {
    upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
    const status = await getGitlabStatus(repoWithRemote('https://gitlab.com/acme/demo.git'));
    expect(status.detected).toBe(true);
    expect(status.account).toBe('me');
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });
});

describe('数据面：无远程 / 无令牌前置校验', () => {
  it('无远程 → INVALID_QUERY 仓库未检测到 GitLab 远程', async () => {
    const err = await captureError(getGitlabMrs(createTmpRepo(), 'opened'));
    expect(err).toMatchObject({ code: 'INVALID_QUERY', message: '仓库未检测到 GitLab 远程' });
  });

  it('有 GitLab 远程但无令牌 → AUTH_FAILED 且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await captureError(getGitlabMrs(repoWithRemote('https://gitlab.com/acme/demo.git'), 'opened'));
    expect(err).toMatchObject({ code: 'AUTH_FAILED', message: '未配置 GitLab 令牌，请在设置中添加' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('gitlabRequest：URL/headers 契约与 GET 映射', () => {
  /** 子组 owner：encodeURIComponent('g/s/repo')='g%2Fs%2Frepo' 在此精确断言 */
  function authedRepo(): string {
    upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://gitlab.com/g/s/repo.git');
  }

  const MR_BASE = 'https://gitlab.com/api/v4/projects/g%2Fs%2Frepo';

  it('getGitlabMrs：GET /merge_requests?state=opened，headers 精确注入（PRIVATE-TOKEN），字段映射', async () => {
    const fetchMock = mockFetchSequence({
      json: [
        {
          iid: 12,
          title: 'Fix thing',
          author: { username: 'alice', name: 'Alice' },
          state: 'opened',
          source_branch: 'feature/fix',
          target_branch: 'main',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T03:04:05Z',
        },
        {
          iid: 9,
          title: 'Merged one',
          author: { username: 'bob' },
          state: 'merged',
          source_branch: 'feature/old',
          target_branch: 'main',
          created_at: '2025-12-01T00:00:00Z',
          updated_at: '2025-12-03T00:00:00Z',
        },
      ],
    });
    const res = await getGitlabMrs(authedRepo(), 'opened');
    expect(res.mrs).toEqual([
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
      {
        iid: 9,
        title: 'Merged one',
        author: 'bob',
        state: 'merged',
        sourceBranch: 'feature/old',
        targetBranch: 'main',
        createdAtIso: '2025-12-01T00:00:00Z',
        updatedAtIso: '2025-12-03T00:00:00Z',
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests?state=opened`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      'PRIVATE-TOKEN': TOKEN,
      Accept: 'application/json',
      'User-Agent': 'rebasedjs',
    });
  });

  it('getGitlabMrs：state=all 透传 query', async () => {
    const fetchMock = mockFetchSequence({ json: [] });
    await getGitlabMrs(authedRepo(), 'all');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests?state=all`);
  });

  it('getGitlabMrDetail：GET /merge_requests/7 + 尽力 reviews；mergeable/reviewState/commentsCount 映射，行数置 0', async () => {
    const fetchMock = mockFetchSequence(
      {
        json: {
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
        },
      },
      {
        json: [
          { id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' },
        ],
      },
    );
    const detail = await getGitlabMrDetail(authedRepo(), 7);
    expect(detail).toEqual({
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
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7`);
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('getGitlabMrDetail：reviews 404 尽力忽略 → NONE；merge_status 非 can_be_merged → mergeable false；description null → 空串', async () => {
    const fetchMock = mockFetchSequence(
      {
        json: {
          iid: 7,
          title: 'Detail',
          author: { username: 'carol' },
          state: 'opened',
          source_branch: 'fix',
          target_branch: 'main',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          description: null,
          merge_status: 'checking',
          user_notes_count: 0,
        },
      },
      { status: 404, json: { message: '404 Not Found' } },
    );
    const detail = await getGitlabMrDetail(authedRepo(), 7);
    expect(detail.body).toBe('');
    expect(detail.mergeable).toBe(false);
    expect(detail.reviewState).toBe('NONE');
    expect(detail.commentsCount).toBe(0);
    expect(detail.additions).toBe(0);
    expect(detail.deletions).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getGitlabMrFiles：GET /merge_requests/7/changes → new_path ?? old_path；旗标状态；行数置 0；diff 缺省 → 空串', async () => {
    const fetchMock = mockFetchSequence({
      json: [
        { new_path: 'a.ts', old_path: 'a.ts', diff: '@@ -1 +1 @@', new_file: false, deleted_file: false },
        { new_path: 'new.ts', old_path: null, new_file: true, deleted_file: false },
        { new_path: 'renamed.ts', old_path: 'old.ts', renamed_file: true, new_file: true, deleted_file: false },
        { new_path: null, old_path: 'del.ts', deleted_file: true, new_file: false },
        { new_path: 'm.ts', old_path: 'm.ts', new_file: false, deleted_file: false, renamed_file: false, diff: null },
      ],
    });
    const res = await getGitlabMrFiles(authedRepo(), 7);
    expect(res.files).toEqual([
      { path: 'a.ts', status: 'modified', additions: 0, deletions: 0, diff: '@@ -1 +1 @@' },
      { path: 'new.ts', status: 'added', additions: 0, deletions: 0, diff: '' },
      // 重命名（new_file 亦为 true 时）→ renamed 优先
      { path: 'renamed.ts', status: 'renamed', additions: 0, deletions: 0, diff: '' },
      { path: 'del.ts', status: 'removed', additions: 0, deletions: 0, diff: '' },
      { path: 'm.ts', status: 'modified', additions: 0, deletions: 0, diff: '' },
    ]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/changes`);
  });
});

describe('gitlabRequest：错误映射与 token 不下发', () => {
  function authedRepo(): string {
    upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://gitlab.com/g/s/repo.git');
  }

  it.each([
    [{ status: 401, json: { message: 'Unauthorized' } }, 'AUTH_FAILED', 'GitLab 认证失败：Unauthorized'],
    [{ status: 403, json: { message: 'Forbidden' } }, 'AUTH_FAILED', 'GitLab 认证失败：Forbidden'],
    [{ status: 404, json: { message: 'Not Found' } }, 'INVALID_REF', 'MR 不存在或无权访问：Not Found'],
    [{ status: 500, json: { message: 'Internal Server Error' } }, 'GIT_ERROR', 'GitLab API 请求失败：500 Internal Server Error'],
    [{ status: 422, json: { message: 'Validation Failed' } }, 'GIT_ERROR', 'GitLab API 请求失败：422 Validation Failed'],
  ])('%j → %s', async (response, code, message) => {
    mockFetchSequence(response as FakeResponse);
    const err = await captureError(getGitlabMrs(authedRepo(), 'opened'));
    expect(err).toMatchObject({ code, message });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('403 且消息含 rate limit → RATE_LIMITED', async () => {
    mockFetchSequence({ status: 403, json: { message: 'API rate limit exceeded for 1.2.3.4' } });
    const err = await captureError(getGitlabMrs(authedRepo(), 'opened'));
    expect(err).toMatchObject({ code: 'RATE_LIMITED', message: 'GitLab API 限流：API rate limit exceeded for 1.2.3.4' });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('429 → RATE_LIMITED', async () => {
    mockFetchSequence({ status: 429, json: { message: 'API rate limit exceeded' } });
    const err = await captureError(getGitlabMrs(authedRepo(), 'opened'));
    expect(err).toMatchObject({ code: 'RATE_LIMITED', message: 'GitLab API 限流：API rate limit exceeded' });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('fetch 网络异常（TypeError）→ GIT_ERROR，消息不含 token', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fn);
    const err = await captureError(getGitlabMrs(authedRepo(), 'opened'));
    expect(err).toMatchObject({ code: 'GIT_ERROR', message: expect.stringContaining('GitLab API 请求失败：') });
    expect((err as { message: string }).message).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });
});

describe('时间线：notes + reviews 合并升序，review id 移位', () => {
  function authedRepo(): string {
    upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://gitlab.com/acme/demo.git');
  }

  it('按 created_at 升序合并；kind/reviewState 映射；review id = 1000000000 + reviewId', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
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
    const timeline = await getGitlabMrTimeline(repo, 7);
    expect(timeline.entries).toEqual([
      { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
      { id: 1000000012, author: 'carol', atIso: '2026-01-02T00:00:00Z', body: 'lgtm', kind: 'review', reviewState: 'APPROVED' },
      { id: 6, author: 'bob', atIso: '2026-01-03T00:00:00Z', body: 'comment 3', kind: 'comment' },
      { id: 1000000013, author: 'dave', atIso: '2026-01-04T00:00:00Z', body: 'needs work', kind: 'review', reviewState: 'CHANGES_REQUESTED' },
      // commented 不在三态内 → COMMENTED（裁定：非 approved/rejected 一律 COMMENTED）
      { id: 1000000014, author: 'erin', atIso: '2026-01-05T00:00:00Z', body: 'hmm', kind: 'review', reviewState: 'COMMENTED' },
    ]);
    expect(new Set(timeline.entries.map((e) => e.id)).size).toBe(timeline.entries.length);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://gitlab.com/api/v4/projects/acme%2Fdemo/merge_requests/7/notes');
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('https://gitlab.com/api/v4/projects/acme%2Fdemo/merge_requests/7/reviews');
  });

  it('reviews 404（尽力）→ 只有 notes', async () => {
    const repo = authedRepo();
    mockFetchSequence(
      { json: [{ id: 1, author: { username: 'x' }, created_at: '2026-01-01T00:00:00Z', body: null }] },
      { status: 404, json: { message: '404 Not Found' } },
    );
    const timeline = await getGitlabMrTimeline(repo, 7);
    expect(timeline.entries).toEqual([{ id: 1, author: 'x', atIso: '2026-01-01T00:00:00Z', body: '', kind: 'comment' }]);
  });

  it('reviews 空数组 → 只有 notes', async () => {
    const repo = authedRepo();
    mockFetchSequence({ json: [{ id: 1, author: { username: 'x' }, created_at: '2026-01-01T00:00:00Z', body: 'b' }] }, { json: [] });
    const timeline = await getGitlabMrTimeline(repo, 7);
    expect(timeline.entries).toEqual([{ id: 1, author: 'x', atIso: '2026-01-01T00:00:00Z', body: 'b', kind: 'comment' }]);
  });
});

describe('写操作：方法/body 契约', () => {
  function authedRepo(): string {
    upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
    return repoWithRemote('https://gitlab.com/g/s/repo.git');
  }

  it('addGitlabMrComment：POST /merge_requests/{iid}/notes 带 JSON body，返回刷新时间线', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 201, json: { id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const timeline = await addGitlabMrComment(repo, 7, 'new comment');
    expect(timeline.entries).toEqual([
      { id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/notes');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('getGitlabMrDiscussions：GET /merge_requests/{iid}/discussions 展平 notes（position 锚点保留 newPath/newLine）', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence({
      json: [
        {
          id: 5,
          notes: [
            { id: 51, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: '这里呢？', position: { new_path: 'src/a.ts', new_line: 5 } },
            { id: 52, author: { username: 'bob' }, created_at: '2026-02-02T00:00:00Z', body: '同上', position: null },
          ],
        },
        { id: 6, notes: [{ id: 61, author: { username: 'carol' }, created_at: '2026-02-03T00:00:00Z', body: '无位置讨论' }] },
      ],
    });

    const result = await getGitlabMrDiscussions(repo, 7);

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/discussions');
    expect(result.notes).toEqual([
      { id: 51, author: 'me', atIso: '2026-02-01T00:00:00Z', body: '这里呢？', newPath: 'src/a.ts', newLine: 5 },
      { id: 52, author: 'bob', atIso: '2026-02-02T00:00:00Z', body: '同上', newPath: null, newLine: null },
      { id: 61, author: 'carol', atIso: '2026-02-03T00:00:00Z', body: '无位置讨论', newPath: null, newLine: null },
    ]);
  });

  it('addGitlabMrDiscussion：POST /discussions 带 {body, position:{position_type,new_path,new_line}}，返回刷新列表', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 201, json: { id: 5, notes: [{ id: 61, author: { username: 'me' }, created_at: '2026-02-04T00:00:00Z', body: '锚定评论', position: { new_path: 'src/a.ts', new_line: 8 } }] } },
      { json: [{ id: 5, notes: [{ id: 61, author: { username: 'me' }, created_at: '2026-02-04T00:00:00Z', body: '锚定评论', position: { new_path: 'src/a.ts', new_line: 8 } }] }] },
    );

    const result = await addGitlabMrDiscussion(repo, 7, { path: 'src/a.ts', line: 8, body: '锚定评论' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/discussions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      body: '锚定评论',
      position: { position_type: 'text', new_path: 'src/a.ts', new_line: 8 },
    });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ id: 61, newLine: 8 });
  });

  it('submitGitlabMrReview：APPROVE → POST .../approve（无 body），返回刷新详情（reviewState APPROVED）', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 200, json: { id: 1, state: 'approved' } },
      {
        json: {
          iid: 7,
          title: 'Detail',
          author: { username: 'x' },
          state: 'opened',
          source_branch: 'fix',
          target_branch: 'main',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          description: 'b',
          merge_status: 'can_be_merged',
          user_notes_count: 1,
        },
      },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const detail = await submitGitlabMrReview(repo, 7, { event: 'APPROVE', body: 'looks good' });
    expect(detail.reviewState).toBe('APPROVED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/approve');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('submitGitlabMrReview：REQUEST_CHANGES → POST .../reviews {"state":"rejected"}，返回刷新详情', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 201, json: { id: 2, state: 'rejected' } },
      {
        json: {
          iid: 7,
          title: 'Detail',
          author: { username: 'x' },
          state: 'opened',
          source_branch: 'fix',
          target_branch: 'main',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          description: 'b',
          merge_status: 'can_be_merged',
          user_notes_count: 0,
        },
      },
      {
        json: [{ id: 21, state: 'rejected', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'nope' }],
      },
    );
    const detail = await submitGitlabMrReview(repo, 7, { event: 'REQUEST_CHANGES', body: 'nope' });
    expect(detail.reviewState).toBe('CHANGES_REQUESTED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/reviews');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ state: 'rejected' }));
  });

  it('submitGitlabMrReview：COMMENT → POST .../notes {"body"}，返回刷新详情', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
      { status: 201, json: { id: 3, body: 'need fix', author: { username: 'me' } } },
      {
        json: {
          iid: 7,
          title: 'Detail',
          author: { username: 'x' },
          state: 'opened',
          source_branch: 'fix',
          target_branch: 'main',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          description: 'b',
          merge_status: 'can_be_merged',
          user_notes_count: 1,
        },
      },
      { json: [] },
    );
    const detail = await submitGitlabMrReview(repo, 7, { event: 'COMMENT', body: 'need fix' });
    expect(detail.commentsCount).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/notes');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'need fix' }));
  });

  it('submitGitlabMrReview：COMMENT 空 body → INVALID_QUERY 评论内容不能为空，且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await captureError(submitGitlabMrReview(authedRepo(), 7, { event: 'COMMENT', body: '' }));
    expect(err).toMatchObject({ code: 'INVALID_QUERY', message: '评论内容不能为空' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createGitlabMr：POST .../merge_requests {source_branch,target_branch,title,description}，重查 detail', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence(
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
    const detail = await createGitlabMr(repo, {
      sourceBranch: 'feature',
      targetBranch: 'main',
      title: 'New MR',
      description: 'D',
    });
    expect(detail.iid).toBe(11);
    expect(detail.title).toBe('New MR');
    expect(detail.body).toBe('D');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ source_branch: 'feature', target_branch: 'main', title: 'New MR', description: 'D' }),
    );
    // 重查 detail 走 GET /merge_requests/11（create 返回后）。
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/11');
  });

  it('mergeGitlabMr：PUT .../merge {squash:true}；200 响应体 state=merged → merged true', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence({ status: 200, json: { state: 'merged', message: 'Merge request merged successfully' } });
    const res = await mergeGitlabMr(repo, 7, { squash: true });
    expect(res).toEqual({ merged: true, message: 'Merge request merged successfully' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/merge');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ squash: true }));
  });

  it('mergeGitlabMr：200 响应体 merged:false → {merged:false, message}；squash 缺省不发送 body 字段', async () => {
    const repo = authedRepo();
    const fetchMock = mockFetchSequence({ status: 200, json: { merged: false, message: 'Merge request is not in a state to merge' } });
    const res = await mergeGitlabMr(repo, 7, {});
    expect(res).toEqual({ merged: false, message: 'Merge request is not in a state to merge' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Frepo/merge_requests/7/merge');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeUndefined();
  });
});

describe('checkoutGitlabMr（真实临时仓库 + 裸仓库装置）', () => {
  const RIG_TIMEOUT = 120000;

  /** origin（或指定名）指向裸仓库；裸仓库含 refs/merge-requests/7/head（独立提交） */
  function makeCheckoutRig(remoteName = 'origin'): { repo: string; bare: string; defaultBranch: string; mrHash: string } {
    const repo = createTmpRepo();
    dirs.push(repo);
    const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
    writeFileSync(join(repo, 'a.txt'), 'base');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);
    const bare = createTmpDir('rebased-gitlab-bare-');
    dirs.push(bare);
    execFileSync('git', ['init', '-q', '--bare', bare]);
    git(repo, ['remote', 'add', remoteName, bare]);
    git(repo, ['push', '-q', '-u', remoteName, defaultBranch]);
    const other = createTmpDir('rebased-gitlab-other-');
    dirs.push(other);
    execFileSync('git', ['clone', '-q', bare, other]);
    writeFileSync(join(other, 'mr.txt'), 'mr-7 content');
    git(other, ['add', 'mr.txt']);
    git(other, ['commit', '-q', '-m', 'mr 7 commit']);
    git(other, ['push', '-q', 'origin', 'HEAD:refs/merge-requests/7/head']);
    const mrHash = git(bare, ['rev-parse', 'refs/merge-requests/7/head']);
    return { repo, bare, defaultBranch, mrHash };
  }

  it('fetch refs/merge-requests/7/head + checkoutNewBranch mr-7：分支建立并已检出', { timeout: RIG_TIMEOUT }, async () => {
    const { repo, mrHash } = makeCheckoutRig();
    const res = await checkoutGitlabMr(repo, 7);
    expect(res).toEqual({ branchName: 'mr-7' });
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('mr-7');
    expect(git(repo, ['rev-parse', '--verify', 'refs/heads/mr-7'])).toBe(mrHash);
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(mrHash);
    // 工作区干净（mr-7 内容已检出而非仅分支引用）
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('分支已存在 → 仅 checkout（不 fetch：origin 指向不存在路径）', { timeout: RIG_TIMEOUT }, async () => {
    const { repo } = makeCheckoutRig();
    git(repo, ['branch', 'mr-7']);
    const base = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['remote', 'set-url', 'origin', join(tmpdir(), 'rebased-gitlab-nowhere')]);
    const res = await checkoutGitlabMr(repo, 7);
    expect(res).toEqual({ branchName: 'mr-7' });
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(base);
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('mr-7');
  });

  it('无 origin 取第一个远程', { timeout: RIG_TIMEOUT }, async () => {
    const { repo, mrHash } = makeCheckoutRig('upstream');
    const res = await checkoutGitlabMr(repo, 7);
    expect(res).toEqual({ branchName: 'mr-7' });
    expect(git(repo, ['rev-parse', '--verify', 'refs/heads/mr-7'])).toBe(mrHash);
  });

  it('无远程 → INVALID_QUERY 未检测到远程', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const err = await captureError(checkoutGitlabMr(repo, 7));
    expect(err).toMatchObject({ code: 'INVALID_QUERY', message: '未检测到远程' });
  });

  it('fetch 失败 → GIT_ERROR（中文消息 + stderr 首行），消息不含 token', { timeout: RIG_TIMEOUT }, async () => {
    // 配置了令牌（注入认证回路）：断言 git 层错误消息也绝不含 token
    upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'base');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);
    git(repo, ['remote', 'add', 'origin', join(tmpdir(), 'rebased-gitlab-nowhere')]);
    const err = await captureError(checkoutGitlabMr(repo, 7));
    expect(err).toMatchObject({
      code: 'GIT_ERROR',
      message: expect.stringContaining('GitLab MR 拉取失败：'),
    });
    expect((err as { message: string }).message).toContain('does not appear to be a git repository');
    expect((err as { message: string }).message).not.toContain(TOKEN);
  });
});
