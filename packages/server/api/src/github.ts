/**
 * GitHub PR 服务：github.com REST 数据面 + 本地 git 检出面（PR-域文件声明见 contracts/domain.ts）。
 * 两平面解耦：
 * - 数据面（status/prs/detail/timeline/comments/files/review/merge）：先解析 GitHub 远程
 *   （仅 https://github.com/{o}/{r}[.git] 与 git@github.com:{o}/{r}[.git] 两形态）→ 令牌 →
 *   统一 githubRequest 出口（错误映射见下）；
 * - git 面（checkoutGithubPr）不解析 URL：按远程名（origin 优先、无则第一个）直接
 *   git fetch refspec + checkout -b，走既有 withAuth 认证回路注入 token。
 * 安全约束：token 只进请求头 Authorization，绝不进任何错误消息/响应/上下文。
 */
import { checkoutBranch, checkoutNewBranch, fetchRemote, GitExitError, listBranches } from '@rebased/core';
import type {
  GitHubCommentBody,
  GitHubMergeBody,
  GitHubPrCheckoutResult,
  GitHubPrDetail,
  GitHubPrFile,
  GitHubPrFiles,
  GitHubPrList,
  GitHubPrMergeResult,
  GitHubPrSummary,
  GitHubRepoRef,
  GitHubReviewBody,
  GitHubReviewComment,
  GitHubReviewCommentBody,
  GitHubReviewComments,
  GitHubStatus,
  GitHubTimeline,
  GitHubTimelineEntry,
} from '@rebased/contracts';
import { normalizeHost, ServiceError } from '@rebased/contracts';
import { getRemotes, withAuth } from './remote';
import { loadConfig } from './lib/config-store';

const GITHUB_HOST = 'github.com';
const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'rebasedjs';
/** 时间线 review 条目 id 偏移：避免与 comment 原始 id 冲突（两者都是 GitHub 数字 id，同域可能交叠）。
 *  阈值远超 GitHub 实际 id 规模，保证前端列表 key 唯一。 */
const REVIEW_ID_OFFSET = 1_000_000_000;

/* ---------------------------------- 远程解析 ---------------------------------- */

/** https://github.com/{owner}/{repo}[.git][/]（owner/repo 各 [A-Za-z0-9_.-]+，狭义正交） */
const HTTPS_GITHUB_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
/** git@github.com:{owner}/{repo}[.git][/]（scp 式 SSH，同形状解析） */
const SSH_GITHUB_RE = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/**
 * 纯函数：两种 GitHub 远程形态 → GitHubRepoRef；其它 URL/路径（非 github.com 域名、
 * gist.github.com 子域除外、含用户名/端口/子路径、ssh:// URL 式、本地路径）→ null。
 * remoteUrl 保留原始 push URL 原样（契约注释：输入源为 git 配置 push URL）。
 */
export function parseGithubRemoteUrl(url: string): GitHubRepoRef | null {
  let m = url.match(HTTPS_GITHUB_RE);
  if (m !== null) return { owner: m[1], name: m[2], remoteUrl: url };
  m = url.match(SSH_GITHUB_RE);
  if (m !== null) return { owner: m[1], name: m[2], remoteUrl: url };
  return null;
}

/* ---------------------------------- 账户查看 ---------------------------------- */

/** github.com 账户簿记视图：token 与账户名（与 auth.findToken 同一查找键约定 normalizeHost）；
 *  仅在服务内部使用，token 除请求头注入外不出本模块。 */
function githubAccount(): { token: string | null; account: string | undefined } {
  const accounts = loadConfig().auth?.accounts ?? [];
  const match = accounts.find((a) => normalizeHost(a.host) === GITHUB_HOST);
  return { token: match?.token ?? null, account: match?.account };
}

/** 首个可解析的 GitHub 远程（按 getRemotes 顺序；parse 输入为 push URL——契约注释明示） */
async function resolveGithubRepoOrNull(repoPath: string): Promise<GitHubRepoRef | null> {
  const { remotes } = await getRemotes(repoPath);
  for (const remote of remotes) {
    const ref = parseGithubRemoteUrl(remote.pushUrl);
    if (ref !== null) return ref;
  }
  return null;
}

interface GithubSession {
  repo: GitHubRepoRef;
  token: string;
}

/** 数据面前置：无 GitHub 远程 → INVALID_QUERY；无令牌 → AUTH_FAILED（先查远程后查令牌） */
async function resolveGithubRepo(repoPath: string): Promise<GithubSession> {
  const repo = await resolveGithubRepoOrNull(repoPath);
  if (repo === null) throw new ServiceError('INVALID_QUERY', '仓库未检测到 GitHub 远程');
  const { token } = githubAccount();
  if (token === null) throw new ServiceError('AUTH_FAILED', '未配置 GitHub 令牌，请在设置中添加');
  return { repo, token };
}

/* ---------------------------------- 数据面 REST ---------------------------------- */

/** REST 统一出口：URL 形态 https://api.github.com/repos/{owner}/{name}{path}，四头注入；
 *  错误映射按控制器裁定（token 绝不进消息）：401 → AUTH_FAILED；403（rate limit → RATE_LIMITED，
 *  否则 AUTH_FAILED）；404 → INVALID_REF；429 或 X-RateLimit-Remaining: 0 → RATE_LIMITED；
 *  其余非 2xx → GIT_ERROR（含状态码与消息）；网络异常 → GIT_ERROR。 */
async function githubRequest<T>(
  session: GithubSession,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/repos/${session.repo.owner}/${session.repo.name}${path}`, {
      method,
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ServiceError('GIT_ERROR', `GitHub API 请求失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const text = await response.text();
  const parsed = parseJson(text);
  const msg = errorMessageOf(parsed, text);
  switch (response.status) {
    case 401:
      throw new ServiceError('AUTH_FAILED', `GitHub 认证失败：${msg}`);
    case 403:
      if (msg.includes('rate limit')) throw new ServiceError('RATE_LIMITED', `GitHub API 限流：${msg}`);
      throw new ServiceError('AUTH_FAILED', `GitHub 认证失败：${msg}`);
    case 404:
      throw new ServiceError('INVALID_REF', `PR 不存在或无权访问：${msg}`);
    default:
      break;
  }
  if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
    throw new ServiceError('RATE_LIMITED', `GitHub API 限流：${msg}`);
  }
  if (!response.ok) {
    throw new ServiceError('GIT_ERROR', `GitHub API 请求失败：${response.status} ${msg}`.trim());
  }
  return parsed as T;
}

function parseJson(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 错误消息提取：JSON 的 message 字段优先（GitHub 错误体标准形状）；否则正文文本截断 200 字符 */
function errorMessageOf(parsed: unknown, text: string): string {
  if (typeof parsed === 'object' && parsed !== null) {
    const m = (parsed as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  const trimmed = text.trim();
  return trimmed === '' ? '' : trimmed.slice(0, 200);
}

/* ---------------------------------- 数据映射 ---------------------------------- */

interface GhUser {
  login: string;
}
interface GhPull {
  number: number;
  title: string;
  user: GhUser | null;
  state: string;
  merged: boolean;
  base: { ref: string };
  head: { ref: string };
  created_at: string;
  updated_at: string;
  body: string | null;
  mergeable: boolean | null;
  review_decision: string | null;
  comments: number;
  additions: number;
  deletions: number;
}
interface GhComment {
  id: number;
  user: GhUser | null;
  created_at: string;
  body: string | null;
}
interface GhReview {
  id: number;
  user: GhUser | null;
  created_at: string;
  body: string | null;
  state: string;
}
interface GhFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
interface GhReviewComment {
  id: number;
  path: string;
  line: number | null;
  original_line: number | null;
  side: 'LEFT' | 'RIGHT';
  user: GhUser | null;
  created_at: string;
  body: string | null;
}

function toPrSummary(p: GhPull): GitHubPrSummary {
  return {
    number: p.number,
    title: p.title,
    author: p.user?.login ?? 'unknown',
    state: p.state === 'open' ? 'open' : 'closed',
    merged: p.merged === true,
    baseRef: p.base.ref,
    headRef: p.head.ref,
    createdAtIso: p.created_at,
    updatedAtIso: p.updated_at,
  };
}

function toPrDetail(p: GhPull): GitHubPrDetail {
  const rd = p.review_decision;
  const reviewDecision: GitHubPrDetail['reviewDecision'] =
    rd === 'APPROVED' || rd === 'CHANGES_REQUESTED' || rd === 'REVIEW_REQUIRED' ? rd : 'NONE';
  return {
    ...toPrSummary(p),
    body: p.body ?? '',
    mergeable: p.mergeable === true,
    reviewDecision,
    commentsCount: p.comments ?? 0,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
  };
}

/** review 决定三态映射：APPROVED/CHANGES_REQUESTED 原样，其余（COMMENTED/DISMISSED 等）→ COMMENTED */
function reviewStateOf(state: string): GitHubTimelineEntry['reviewState'] {
  if (state === 'APPROVED') return 'APPROVED';
  if (state === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  return 'COMMENTED';
}

const FILE_STATUSES = new Set<string>(['added', 'modified', 'removed', 'renamed']);

/** review comment → 契约形状：line 优先（新侧），缺失兜底 original_line（旧侧——GitHub 对旧侧评论给 line 为 null）；两者皆无保留 null（UI 丢弃无锚点条目） */
function toReviewComment(c: GhReviewComment): GitHubReviewComment {
  return {
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    author: c.user?.login ?? 'unknown',
    atIso: c.created_at,
    body: c.body ?? '',
  };
}

/* ---------------------------------- 服务入口 ---------------------------------- */

/** GitHub 域可用性：不抛错——无远程/异常 → detected:false；有远程无令牌 → 无 account；有令牌 → 附 account 名 */
export async function getGithubStatus(repoPath: string): Promise<GitHubStatus> {
  try {
    const repo = await resolveGithubRepoOrNull(repoPath);
    if (repo === null) return { detected: false };
    const { token, account } = githubAccount();
    if (token === null) return { detected: true, repo };
    return { detected: true, repo, account };
  } catch {
    return { detected: false };
  }
}

/** PR 列表：GET /pulls?state={open|closed|all} */
export async function getGithubPrs(repoPath: string, state: 'open' | 'closed' | 'all'): Promise<GitHubPrList> {
  const session = await resolveGithubRepo(repoPath);
  const pulls = await githubRequest<GhPull[]>(session, `/pulls?state=${state}`);
  return { prs: pulls.map(toPrSummary) };
}

/** PR 详情：GET /pulls/{n} */
export async function getGithubPrDetail(repoPath: string, number: number): Promise<GitHubPrDetail> {
  const session = await resolveGithubRepo(repoPath);
  return toPrDetail(await githubRequest<GhPull>(session, `/pulls/${number}`));
}

/** 时间线：GET issues/{n}/comments + GET pulls/{n}/reviews，按 created_at 升序合并（ISO 串字典序即时间序） */
export async function getGithubPrTimeline(repoPath: string, number: number): Promise<GitHubTimeline> {
  const session = await resolveGithubRepo(repoPath);
  const comments = await githubRequest<GhComment[]>(session, `/issues/${number}/comments`);
  const reviews = await githubRequest<GhReview[]>(session, `/pulls/${number}/reviews`);
  const entries: GitHubTimelineEntry[] = [
    ...comments.map((c) => ({
      id: c.id,
      author: c.user?.login ?? 'unknown',
      atIso: c.created_at,
      body: c.body ?? '',
      kind: 'comment' as const,
    })),
    ...reviews.map((r) => ({
      // 裁定：review 条目 id = 1000000000 + reviewId（注释见 REVIEW_ID_OFFSET），保证与 comment id 全局唯一
      id: REVIEW_ID_OFFSET + r.id,
      author: r.user?.login ?? 'unknown',
      atIso: r.created_at,
      body: r.body ?? '',
      kind: 'review' as const,
      reviewState: reviewStateOf(r.state),
    })),
  ];
  entries.sort((a, b) => a.atIso.localeCompare(b.atIso));
  return { entries };
}

/** 添加评论：POST issues/{n}/comments；返回刷新后的完整时间线 */
export async function addGithubPrComment(repoPath: string, number: number, body: GitHubCommentBody['body']): Promise<GitHubTimeline> {
  const session = await resolveGithubRepo(repoPath);
  await githubRequest<GhComment>(session, `/issues/${number}/comments`, { method: 'POST', body: { body } });
  return getGithubPrTimeline(repoPath, number);
}

/** 行级评审评论列表：GET pulls/{n}/comments（评审内联评论——区别于 issues/{n}/comments 的全局评论） */
export async function getGithubPrReviewComments(repoPath: string, number: number): Promise<GitHubReviewComments> {
  const session = await resolveGithubRepo(repoPath);
  const comments = await githubRequest<GhReviewComment[]>(session, `/pulls/${number}/comments`);
  return { comments: comments.map(toReviewComment) };
}

/** 添加行级评审评论：POST pulls/{n}/comments {path,line,side,body}（line 为新侧行号，side 恒 RIGHT——本产品录入口径）；返回刷新后的完整列表 */
export async function addGithubPrReviewComment(
  repoPath: string,
  number: number,
  body: GitHubReviewCommentBody,
): Promise<GitHubReviewComments> {
  const session = await resolveGithubRepo(repoPath);
  await githubRequest<GhReviewComment>(session, `/pulls/${number}/comments`, { method: 'POST', body });
  return getGithubPrReviewComments(repoPath, number);
}

/** PR 文件：GET pulls/{n}/files；patch 缺省（API 行为）→ '' */
export async function getGithubPrFiles(repoPath: string, number: number): Promise<GitHubPrFiles> {
  const session = await resolveGithubRepo(repoPath);
  const files = await githubRequest<GhFile[]>(session, `/pulls/${number}/files`);
  return {
    files: files.map((f): GitHubPrFile => ({
      path: f.filename,
      status: FILE_STATUSES.has(f.status) ? (f.status as GitHubPrFile['status']) : 'modified',
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: f.patch ?? '',
    })),
  };
}

/** 提交 review：POST pulls/{n}/reviews {event, body}；返回刷新后的 PR 详情 */
export async function submitGithubPrReview(
  repoPath: string,
  number: number,
  body: GitHubReviewBody,
): Promise<GitHubPrDetail> {
  const session = await resolveGithubRepo(repoPath);
  await githubRequest<GhReview>(session, `/pulls/${number}/reviews`, {
    method: 'POST',
    body: { event: body.event, body: body.body },
  });
  return getGithubPrDetail(repoPath, number);
}

/** 合并 PR：POST pulls/{n}/merge {merge_method}（契约形状显式映射，丢弃 sha 等多余字段） */
export async function mergeGithubPr(repoPath: string, number: number, body: GitHubMergeBody): Promise<GitHubPrMergeResult> {
  const session = await resolveGithubRepo(repoPath);
  const res = await githubRequest<{ merged: boolean; message: string }>(session, `/pulls/${number}/merge`, {
    method: 'POST',
    body: { merge_method: body.method },
  });
  return { merged: res.merged === true, message: res.message };
}

/* ---------------------------------- git 检出面 ---------------------------------- */

/**
 * 检出 PR 分支：不解析远程 URL（与数据面解耦）。
 * - 远程选择：name==='origin' 优先，无则取第一个；无任何远程 → INVALID_QUERY '未检测到远程'；
 * - 本地分支 pr-N 已存在（本次或上次检出残留）→ 仅 checkoutBranch，不再 fetch；
 * - 否则 git fetch <remote> +refs/pull/N/head（走 withAuth 认证回路注入 token）→
 *   checkoutNewBranch('pr-N', 'FETCH_HEAD')；
 * - fetch/checkout 失败 → GIT_ERROR（中文前缀 + stderr 首行）；认证失败经 withAuth 折 AUTH_FAILED。
 */
export async function checkoutGithubPr(repoPath: string, number: number): Promise<GitHubPrCheckoutResult> {
  const remotes = (await getRemotes(repoPath)).remotes;
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
  if (remote === undefined) throw new ServiceError('INVALID_QUERY', '未检测到远程');
  const branchName = `pr-${number}`;
  const branches = await listBranches(repoPath);
  if (branches.some((b) => !b.remote && b.name === branchName)) {
    await checkoutBranch(repoPath, branchName);
    return { branchName };
  }
  try {
    await withAuth(repoPath, remote.name, (extraConfig) =>
      fetchRemote(repoPath, { remote: remote.name, refspec: `+refs/pull/${number}/head`, extraConfig }),
    );
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw gitFailure('GitHub PR 拉取失败', error);
  }
  try {
    await checkoutNewBranch(repoPath, branchName, 'FETCH_HEAD');
  } catch (error) {
    throw gitFailure('GitHub PR 检出失败', error);
  }
  return { branchName };
}

/** GitExitError → GIT_ERROR（中文前缀 + stderr 首行；其余错误类型取 message 兜底） */
function gitFailure(prefix: string, error: unknown): ServiceError {
  const detail =
    error instanceof GitExitError
      ? error.stderr.trim().split('\n')[0] || ''
      : error instanceof Error
        ? error.message
        : String(error);
  return new ServiceError('GIT_ERROR', `${prefix}：${detail}`, { cause: error });
}
