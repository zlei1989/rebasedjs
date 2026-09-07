/**
 * GitLab MR 服务：gitlab.com REST 数据面 + 本地 git 检出面（MR-域文件声明见 contracts/domain.ts）。
 * 两平面解耦（同 github.ts：P3-E 模板）：
 * - 数据面（status/mrs/detail/timeline/comments/files/review/merge/create）：先解析 GitLab 远程
 *   （仅 https://gitlab.com/{group[/sub]}/{repo}[.git] 与 git@gitlab.com:{group[/sub]}/{repo}[.git]
 *   两形态，owner 为全路径含子组）→ 令牌 → 统一 gitlabRequest 出口（错误映射见下）；
 * - git 面（checkoutGitlabMr）不解析 URL：按远程名（origin 优先、无则第一个）直接
 *   git fetch refs/merge-requests/{iid}/head + checkout -b mr-{iid}，走既有 withAuth 认证回路注入 token。
 * 安全约束：token 只进 PRIVATE-TOKEN 请求头，绝不进任何错误消息/响应/上下文。
 */
import { checkoutBranch, checkoutNewBranch, fetchRemote, GitExitError, listBranches } from '@rebased/core';
import type {
  GitLabDiscussionBody,
  GitLabDiscussionNote,
  GitLabDiscussions,
  GitLabMergeBody,
  GitLabMrCheckoutResult,
  GitLabMrCreateBody,
  GitLabMrDetail,
  GitLabMrFile,
  GitLabMrFiles,
  GitLabMrList,
  GitLabMrMergeResult,
  GitLabMrSummary,
  GitLabRepoRef,
  GitLabReviewBody,
  GitLabStatus,
  GitLabTimeline,
  GitLabTimelineEntry,
} from '@rebased/contracts';
import { normalizeHost, ServiceError } from '@rebased/contracts';
import { getRemotes, withAuth } from './remote';
import { loadConfig } from './lib/config-store';

const GITLAB_HOST = 'gitlab.com';
const API_BASE = 'https://gitlab.com/api/v4';
const USER_AGENT = 'rebasedjs';
/** 时间线 review 条目 id 偏移：避免与 comment 原始 id 冲突（GitLab note/review 均为数字 id，同域可能交叠）。
 *  阈值远超 GitLab 实际 id 规模，保证前端列表 key 唯一。 */
const REVIEW_ID_OFFSET = 1_000_000_000;

/* ---------------------------------- 远程解析 ---------------------------------- */

/**
 * https://gitlab.com/{group[/sub]}/{repo}[.git][/]——owner 多级（子组）`[\w.-]+(/[\w.-]+)*`，
 * repo 取末段（可含点）；gitlab.com 之外域名/本地路径/user@/端口/ssh:// URL 式 → null。
 * 深层路径（如 acme/demo/extra）按子组语义解析（acme/demo 为组——GitLab 嵌套组为常态，与 github
 * 单层 owner 的「子路径 → null」不同）；owner 任一分段不得以 .git 结尾（GitLab 保留后缀，
 * 防止 demo.git/extra 这类非项目路径误入）。
 */
const HTTPS_GITLAB_RE = /^https:\/\/gitlab\.com\/([\w.-]+(?:\/[\w.-]+)*)\/([\w.-]+?)(?:\.git)?\/?$/;
/** git@gitlab.com:{group[/sub]}/{repo}[.git][/]（scp 式 SSH，同形状解析） */
const SSH_GITLAB_RE = /^git@gitlab\.com:([\w.-]+(?:\/[\w.-]+)*)\/([\w.-]+?)(?:\.git)?\/?$/;

/**
 * 纯函数：两种 GitLab 远程形态 → GitLabRepoRef；其它 URL/路径 → null。
 * remoteUrl 保留原始 push URL 原样（契约注释：输入源为 git 配置 push URL）。
 */
export function parseGitlabRemoteUrl(url: string): GitLabRepoRef | null {
  let m = url.match(HTTPS_GITLAB_RE);
  if (m !== null && !hasGitSuffixSegment(m[1])) return { owner: m[1], name: m[2], remoteUrl: url };
  m = url.match(SSH_GITLAB_RE);
  if (m !== null && !hasGitSuffixSegment(m[1])) return { owner: m[1], name: m[2], remoteUrl: url };
  return null;
}

/** owner 任一分段以 .git 结尾 → 非项目路径（GitLab 保留后缀） */
function hasGitSuffixSegment(owner: string): boolean {
  return owner.split('/').some((seg) => seg.endsWith('.git'));
}

/* ---------------------------------- 账户查看 ---------------------------------- */

/** gitlab.com 账户簿记视图：token 与账户名（与 auth.findToken 同一查找键约定 normalizeHost）；
 *  仅在服务内部使用，token 除请求头注入外不出本模块。 */
function gitlabAccount(): { token: string | null; account: string | undefined } {
  const accounts = loadConfig().auth?.accounts ?? [];
  const match = accounts.find((a) => normalizeHost(a.host) === GITLAB_HOST);
  return { token: match?.token ?? null, account: match?.account };
}

/** 首个可解析的 GitLab 远程（按 getRemotes 顺序；parse 输入为 push URL——契约注释明示） */
async function resolveGitlabRepoOrNull(repoPath: string): Promise<GitLabRepoRef | null> {
  const { remotes } = await getRemotes(repoPath);
  for (const remote of remotes) {
    const ref = parseGitlabRemoteUrl(remote.pushUrl);
    if (ref !== null) return ref;
  }
  return null;
}

interface GitlabSession {
  repo: GitLabRepoRef;
  token: string;
}

/** 数据面前置：无 GitLab 远程 → INVALID_QUERY；无令牌 → AUTH_FAILED（先查远程后查令牌） */
async function resolveGitlabRepo(repoPath: string): Promise<GitlabSession> {
  const repo = await resolveGitlabRepoOrNull(repoPath);
  if (repo === null) throw new ServiceError('INVALID_QUERY', '仓库未检测到 GitLab 远程');
  const { token } = gitlabAccount();
  if (token === null) throw new ServiceError('AUTH_FAILED', '未配置 GitLab 令牌，请在设置中添加');
  return { repo, token };
}

/* ---------------------------------- 数据面 REST ---------------------------------- */

/**
 * REST 统一出口：URL 形态 https://gitlab.com/api/v4/projects/{owner%2Frepo}{path}（owner 全路径
 * encodeURIComponent，子组斜杠编码为 %2F）；三头注入（PRIVATE-TOKEN 而非 Bearer）。
 * 错误映射按控制器裁定（token 绝不进消息）：401 → AUTH_FAILED；403（rate limit → RATE_LIMITED，
 * 否则 AUTH_FAILED）；404 → INVALID_REF；429 → RATE_LIMITED；其余非 2xx → GIT_ERROR
 * （含状态码与消息）；网络异常 → GIT_ERROR。
 */
async function gitlabRequest<T>(
  session: GitlabSession,
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown },
): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = {
    'PRIVATE-TOKEN': session.token,
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const projectId = encodeURIComponent(`${session.repo.owner}/${session.repo.name}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/projects/${projectId}${path}`, {
      method,
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ServiceError('GIT_ERROR', `GitLab API 请求失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const text = await response.text();
  const parsed = parseJson(text);
  const msg = errorMessageOf(parsed, text);
  switch (response.status) {
    case 401:
      throw new ServiceError('AUTH_FAILED', `GitLab 认证失败：${msg}`);
    case 403:
      if (msg.includes('rate limit')) throw new ServiceError('RATE_LIMITED', `GitLab API 限流：${msg}`);
      throw new ServiceError('AUTH_FAILED', `GitLab 认证失败：${msg}`);
    case 404:
      throw new ServiceError('INVALID_REF', `MR 不存在或无权访问：${msg}`);
    case 429:
      throw new ServiceError('RATE_LIMITED', `GitLab API 限流：${msg}`);
    default:
      break;
  }
  if (!response.ok) {
    throw new ServiceError('GIT_ERROR', `GitLab API 请求失败：${response.status} ${msg}`.trim());
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

/** 错误消息提取：JSON 的 message 字段优先（GitLab 错误体标准形状）；否则正文文本截断 200 字符 */
function errorMessageOf(parsed: unknown, text: string): string {
  if (typeof parsed === 'object' && parsed !== null) {
    const m = (parsed as { message?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  const trimmed = text.trim();
  return trimmed === '' ? '' : trimmed.slice(0, 200);
}

/**
 * reviews 端点尽力拉取（裁定 4/时间线）：部分 GitLab 实例/权限下端点不可用——4xx 类错误
 * （404 → INVALID_REF、401/403 → AUTH_FAILED、429 → RATE_LIMITED）忽略并视为无 review；
 * 网络异常与 5xx（GIT_ERROR）仍按全局映射透出。空数组/非数组同视为无。
 */
async function fetchBestEffortReviews(session: GitlabSession, iid: number): Promise<GlReview[]> {
  try {
    const reviews = await gitlabRequest<unknown>(session, `/merge_requests/${iid}/reviews`);
    return Array.isArray(reviews) ? (reviews as GlReview[]) : [];
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === 'INVALID_REF' || error.code === 'AUTH_FAILED' || error.code === 'RATE_LIMITED')
    ) {
      return [];
    }
    throw error;
  }
}

/* ---------------------------------- 数据映射 ---------------------------------- */

interface GlUser {
  username?: string;
  name?: string;
}
interface GlMr {
  iid: number;
  title: string;
  author: GlUser | null;
  state: string;
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  description?: string | null;
  merge_status?: string;
  user_notes_count?: number;
}
interface GlNote {
  id: number;
  body?: string | null;
  author?: GlUser | null;
  created_at?: string;
}
interface GlReview {
  id: number;
  state?: string;
  body?: string | null;
  author?: GlUser | null;
  created_at?: string;
}
interface GlFileChange {
  new_path?: string | null;
  old_path?: string | null;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string | null;
}
/** 行级讨论注记：position（内联文本讨论锚点：new_path + new_line）；无 position 的讨论为全局讨论，不入行级线程 */
interface GlDiscussionNote {
  id: number;
  body?: string | null;
  author?: GlUser | null;
  created_at?: string;
  position?: { new_path?: string | null; new_line?: number | null } | null;
}
interface GlDiscussion {
  id: number;
  notes?: GlDiscussionNote[] | null;
}

const MR_STATES = new Set<string>(['opened', 'closed', 'merged', 'locked']);

function authorNameOf(a: GlUser | null | undefined): string {
  return a?.username ?? a?.name ?? 'unknown';
}

function mrStateOf(state: string): GitLabMrSummary['state'] {
  return MR_STATES.has(state) ? (state as GitLabMrSummary['state']) : 'closed';
}

function toMrSummary(m: GlMr): GitLabMrSummary {
  return {
    iid: m.iid,
    title: m.title,
    author: authorNameOf(m.author),
    state: mrStateOf(m.state),
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    createdAtIso: m.created_at,
    updatedAtIso: m.updated_at,
  };
}

/** review state → 时间线三态：approved→APPROVED / rejected→CHANGES_REQUESTED / 其余→COMMENTED */
function timelineReviewStateOf(state: string): GitLabTimelineEntry['reviewState'] {
  if (state === 'approved') return 'APPROVED';
  if (state === 'rejected') return 'CHANGES_REQUESTED';
  return 'COMMENTED';
}

/** detail reviewState：最近一次 review 的决定（按 created_at 升序取末条）；未审 → NONE。
 *  REVIEW_REQUIRED 为契约并集成员，v1 数据面不产出（GitLab REST MR 对象无 review 决定字段） */
function detailReviewStateOf(reviews: GlReview[]): GitLabMrDetail['reviewState'] {
  if (reviews.length === 0) return 'NONE';
  const sorted = [...reviews].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const latest = sorted[sorted.length - 1];
  if (latest.state === 'approved') return 'APPROVED';
  if (latest.state === 'rejected') return 'CHANGES_REQUESTED';
  return 'NONE';
}

function toMrDetail(m: GlMr, reviews: GlReview[]): GitLabMrDetail {
  return {
    ...toMrSummary(m),
    body: m.description ?? '',
    mergeable: m.merge_status === 'can_be_merged',
    reviewState: detailReviewStateOf(reviews),
    commentsCount: m.user_notes_count ?? 0,
    // GitLab MR 对象/接口无逐 MR 增删行数（changes 只给 diff 文本，见 files 映射）——v1 统一置 0
    additions: 0,
    deletions: 0,
  };
}

/** changes 旗标 → 状态：renamed 优先（重命名条目 new_file 亦可能为 true），再 added/removed，否则 modified */
function fileStatusOf(c: GlFileChange): GitLabMrFile['status'] {
  if (c.renamed_file === true) return 'renamed';
  if (c.new_file === true) return 'added';
  if (c.deleted_file === true) return 'removed';
  return 'modified';
}

/* ---------------------------------- 服务入口 ---------------------------------- */

/** GitLab 域可用性：不抛错——无远程/异常 → detected:false；有远程无令牌 → 无 account；有令牌 → 附 account 名 */
export async function getGitlabStatus(repoPath: string): Promise<GitLabStatus> {
  try {
    const repo = await resolveGitlabRepoOrNull(repoPath);
    if (repo === null) return { detected: false };
    const { token, account } = gitlabAccount();
    if (token === null) return { detected: true, repo };
    return { detected: true, repo, account };
  } catch {
    return { detected: false };
  }
}

/** MR 列表：GET /projects/:id/merge_requests?state={opened|closed|merged|locked|all} */
export async function getGitlabMrs(repoPath: string, state: 'opened' | 'closed' | 'merged' | 'locked' | 'all'): Promise<GitLabMrList> {
  const session = await resolveGitlabRepo(repoPath);
  const mrs = await gitlabRequest<GlMr[]>(session, `/merge_requests?state=${state}`);
  return { mrs: mrs.map(toMrSummary) };
}

/**
 * 创建 MR：POST /projects/:id/merge_requests {source_branch,target_branch,title,description?}；
 * 返回重查后的详情（含尽力 review 决定）。
 */
export async function createGitlabMr(repoPath: string, body: GitLabMrCreateBody): Promise<GitLabMrDetail> {
  const session = await resolveGitlabRepo(repoPath);
  const created = await gitlabRequest<GlMr>(session, '/merge_requests', {
    method: 'POST',
    body: {
      source_branch: body.sourceBranch,
      target_branch: body.targetBranch,
      title: body.title,
      ...(body.description === undefined ? {} : { description: body.description }),
    },
  });
  return getGitlabMrDetail(repoPath, created.iid);
}

/** MR 详情：GET /merge_requests/{iid} + 尽力 reviews（reviewState 唯一来源——MR 对象无 review 决定字段） */
export async function getGitlabMrDetail(repoPath: string, iid: number): Promise<GitLabMrDetail> {
  const session = await resolveGitlabRepo(repoPath);
  const mr = await gitlabRequest<GlMr>(session, `/merge_requests/${iid}`);
  const reviews = await fetchBestEffortReviews(session, iid);
  return toMrDetail(mr, reviews);
}

/** 时间线：GET .../notes + GET .../reviews（尽力），按 created_at 升序合并（ISO 串字典序即时间序） */
export async function getGitlabMrTimeline(repoPath: string, iid: number): Promise<GitLabTimeline> {
  const session = await resolveGitlabRepo(repoPath);
  const notes = await gitlabRequest<GlNote[]>(session, `/merge_requests/${iid}/notes`);
  const reviews = await fetchBestEffortReviews(session, iid);
  const entries: GitLabTimelineEntry[] = [
    ...notes.map((n) => ({
      id: n.id,
      author: authorNameOf(n.author),
      atIso: n.created_at ?? '',
      body: n.body ?? '',
      kind: 'comment' as const,
    })),
    ...reviews.map((r) => ({
      // 裁定：review 条目 id = 1000000000 + reviewId（注释见 REVIEW_ID_OFFSET），保证与 comment id 全局唯一
      id: REVIEW_ID_OFFSET + r.id,
      author: authorNameOf(r.author),
      atIso: r.created_at ?? '',
      body: r.body ?? '',
      kind: 'review' as const,
      reviewState: timelineReviewStateOf(r.state ?? ''),
    })),
  ];
  entries.sort((a, b) => a.atIso.localeCompare(b.atIso));
  return { entries };
}

/** 添加评论：POST .../notes {body}；返回刷新后的完整时间线 */
export async function addGitlabMrComment(repoPath: string, iid: number, body: string): Promise<GitLabTimeline> {
  const session = await resolveGitlabRepo(repoPath);
  await gitlabRequest<GlNote>(session, `/merge_requests/${iid}/notes`, { method: 'POST', body: { body } });
  return getGitlabMrTimeline(repoPath, iid);
}

/** 行级讨论注记 → 契约形状：newPath/newLine 取 position（无锚点 → null，UI 按 path+line 过滤） */
function toDiscussionNote(n: GlDiscussionNote): GitLabDiscussionNote {
  return {
    id: n.id,
    author: authorNameOf(n.author),
    atIso: n.created_at ?? '',
    body: n.body ?? '',
    newPath: n.position?.new_path ?? null,
    newLine: n.position?.new_line ?? null,
  };
}

/** 行级讨论注记列表：GET .../discussions → 展平各讨论的 notes（讨论序 → 注记序；原 id 序不重排——挂靠展示以线程为准） */
export async function getGitlabMrDiscussions(repoPath: string, iid: number): Promise<GitLabDiscussions> {
  const session = await resolveGitlabRepo(repoPath);
  const raw = await gitlabRequest<unknown>(session, `/merge_requests/${iid}/discussions`);
  const list = Array.isArray(raw) ? (raw as GlDiscussion[]) : [];
  const notes = list.flatMap((d) => (d.notes ?? []).map(toDiscussionNote));
  return { notes };
}

/** 添加行级讨论：POST .../discussions {body, position:{position_type:'text', new_path, new_line}}（新侧锚定）；返回刷新后的注记列表 */
export async function addGitlabMrDiscussion(
  repoPath: string,
  iid: number,
  body: GitLabDiscussionBody,
): Promise<GitLabDiscussions> {
  const session = await resolveGitlabRepo(repoPath);
  await gitlabRequest<unknown>(session, `/merge_requests/${iid}/discussions`, {
    method: 'POST',
    body: { body: body.body, position: { position_type: 'text', new_path: body.path, new_line: body.line } },
  });
  return getGitlabMrDiscussions(repoPath, iid);
}

/** MR 文件：GET .../changes → changes[] 映射 {path: new_path ?? old_path, status 按旗标,
 *  additions/deletions: 0（GitLab changes 不逐文件给行数——v1 置 0，diff 全文见 change.diff ?? ''）} */
export async function getGitlabMrFiles(repoPath: string, iid: number): Promise<GitLabMrFiles> {
  const session = await resolveGitlabRepo(repoPath);
  const changes = await gitlabRequest<GlFileChange[]>(session, `/merge_requests/${iid}/changes`);
  return {
    files: changes.map((c): GitLabMrFile => ({
      path: c.new_path ?? c.old_path ?? '',
      status: fileStatusOf(c),
      additions: 0,
      deletions: 0,
      diff: c.diff ?? '',
    })),
  };
}

/**
 * 提交 review（裁定 6）：APPROVE → POST .../approve；REQUEST_CHANGES → POST .../reviews
 * {"state":"rejected"}；COMMENT → POST .../notes {"body"}（body 空 → INVALID_QUERY，先校验后请求）。
 * 返回刷新后的 MR 详情。
 */
export async function submitGitlabMrReview(
  repoPath: string,
  iid: number,
  body: GitLabReviewBody,
): Promise<GitLabMrDetail> {
  const session = await resolveGitlabRepo(repoPath);
  switch (body.event) {
    case 'APPROVE':
      await gitlabRequest<unknown>(session, `/merge_requests/${iid}/approve`, { method: 'POST' });
      break;
    case 'REQUEST_CHANGES':
      await gitlabRequest<unknown>(session, `/merge_requests/${iid}/reviews`, {
        method: 'POST',
        body: { state: 'rejected' },
      });
      break;
    case 'COMMENT': {
      const text = body.body ?? '';
      if (text.trim() === '') {
        throw new ServiceError('INVALID_QUERY', '评论内容不能为空');
      }
      await gitlabRequest<unknown>(session, `/merge_requests/${iid}/notes`, { method: 'POST', body: { body: text } });
      break;
    }
  }
  return getGitlabMrDetail(repoPath, iid);
}

/**
 * 合并 MR：PUT .../merge {squash?}。GitLab 合并结果在响应体（HTTP 层 200 但 merged 状态非 HTTP
 * 状态）：state==='merged' 或 merged:true → merged；否则 false 并透出 message；405/409 等 →
 * 错误映射（gitlabRequest 兜底 GIT_ERROR）。
 */
export async function mergeGitlabMr(repoPath: string, iid: number, body: GitLabMergeBody): Promise<GitLabMrMergeResult> {
  const session = await resolveGitlabRepo(repoPath);
  const res = await gitlabRequest<{ state?: string; merged?: boolean; message?: string }>(session, `/merge_requests/${iid}/merge`, {
    method: 'PUT',
    body: body.squash === undefined ? undefined : { squash: body.squash },
  });
  const merged = res.state === 'merged' || res.merged === true;
  const message =
    typeof res.message === 'string' && res.message !== ''
      ? res.message
      : merged
        ? 'Merge request merged successfully'
        : 'Merge request is not in a state to merge';
  return { merged, message };
}

/* ---------------------------------- git 检出面 ---------------------------------- */

/**
 * 检出 MR 分支：不解析远程 URL（与数据面解耦，同 checkoutGithubPr）。
 * - 远程选择：name==='origin' 优先，无则取第一个；无任何远程 → INVALID_QUERY '未检测到远程'；
 * - 本地分支 mr-N 已存在（本次或上次检出残留）→ 仅 checkoutBranch，不再 fetch；
 * - 否则 git fetch <remote> +refs/merge-requests/N/head（走 withAuth 认证回路注入 token）→
 *   checkoutNewBranch('mr-N', 'FETCH_HEAD')；
 * - fetch/checkout 失败 → GIT_ERROR（中文前缀 + stderr 首行）；认证失败经 withAuth 折 AUTH_FAILED。
 */
export async function checkoutGitlabMr(repoPath: string, iid: number): Promise<GitLabMrCheckoutResult> {
  const remotes = (await getRemotes(repoPath)).remotes;
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
  if (remote === undefined) throw new ServiceError('INVALID_QUERY', '未检测到远程');
  const branchName = `mr-${iid}`;
  const branches = await listBranches(repoPath);
  if (branches.some((b) => !b.remote && b.name === branchName)) {
    await checkoutBranch(repoPath, branchName);
    return { branchName };
  }
  try {
    await withAuth(repoPath, remote.name, (extraConfig) =>
      fetchRemote(repoPath, { remote: remote.name, refspec: `+refs/merge-requests/${iid}/head`, extraConfig }),
    );
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw gitFailure('GitLab MR 拉取失败', error);
  }
  try {
    await checkoutNewBranch(repoPath, branchName, 'FETCH_HEAD');
  } catch (error) {
    throw gitFailure('GitLab MR 检出失败', error);
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
