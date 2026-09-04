/**
 * 远程功能：core 远程原语 → contracts 形状。
 * - 写操作（add/remove/setUrl）前预检重名/不存在，操作后返回刷新列表；
 * - 数据传输三操作（fetch/pull/push）统一走 withAuth 认证回路（token 注入 + AUTH_FAILED 识别）。
 */
import {
  addRemote,
  fetchRemote,
  GitExitError,
  listRemotes,
  pullRemote,
  pushBranch,
  removeRemote,
  setRemoteUrl,
} from '@rebased/core';
import type {
  FetchBody,
  FetchResult,
  PullBody,
  PullOutcome,
  PushBody,
  PushOutcome,
  RemoteAction,
  RemoteList,
} from '@rebased/contracts';
import { normalizeHost, ServiceError } from '@rebased/contracts';
import { findToken } from './auth';

/**
 * git stderr 认证特征判定（LC_ALL=C 固定英文输出）：
 * - 'Authentication failed'：凭据被远端拒绝；
 * - 'could not read Username' / 'terminal prompts disabled'：GIT_TERMINAL_PROMPT=0 下无凭据的
 *   http(s) 远程在 401 后索要交互输入被立即拒（本机实测该特征真实出现）；
 * - '401'/'403'：smart-http 鉴权拒绝状态码。
 */
export function isAuthFailure(stderr: string): boolean {
  return ['Authentication failed', 'could not read Username', 'terminal prompts disabled', '401', '403'].some((s) =>
    stderr.includes(s),
  );
}

/**
 * token → git -c 注入项：http.<baseurl> 条件节语法（git 按 URL 前缀匹配该节，key 大小写不敏感）。
 * 端口语义（git config --get-urlmatch 实测）：
 * - 带显式非默认端口的远程 URL（如 http://127.0.0.1:8080/repo.git）只匹配
 *   http.http://127.0.0.1:8080.extraheader——无端口节不匹配带端口 URL，
 *   故节名 authority 一律取 new URL(remoteUrl).host（含非默认端口）；
 * - 默认端口（http:80/https:443）由 URL 规范化自动去除，与 git 的 URL 规范化一致；
 *   URL 解析器对 http(s) 这类 special scheme 亦自动小写 scheme+host。
 * 注意区分两个键：账户查找键 = normalizeHost（去端口唯一约定，调用方负责）；
 * 注入节 authority = 远程 URL 本体的完整 host——注入键 ≠ 查找键，勿混用。
 * 仅 http/https 远程有注入意义；scp 式 ssh、本地路径等返回空数组。
 * 进程参数可见性为已知接受面（见 core exec.ts buildArgs 注释）。
 */
export function buildAuthConfig(remoteUrl: string, token: string): string[] {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return [];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
  return [`http.${url.protocol}//${url.host}.extraHeader=Authorization: Bearer ${token}`];
}

/**
 * 认证回路公共包装（fetch/pull/push 共用）：
 * ① 解析目标远程 URL（remoteName 缺省 = 全部远程，含 pushUrl）：查找键 = normalizeHost（去端口唯一约定），
 *    有 token 则以 extraConfig 注入 buildAuthConfig(remoteUrl, token) 条目
 *    （注入节 authority 取自 URL 本体、含非默认端口，见 buildAuthConfig）；
 * ② git 失败且 stderr 命中认证特征 → ServiceError('AUTH_FAILED', context: { host })（错误体只带 host，绝不含 token）；
 * ③ 其余错误原样透出（框架层经 toServiceError 折 GIT_ERROR）。
 */
async function withAuth<T>(
  repoPath: string,
  remoteName: string | undefined,
  gitOp: (extraConfig: string[]) => Promise<T>,
): Promise<T> {
  const remotes = await listRemotes(repoPath);
  const targets = remoteName === undefined ? remotes : remotes.filter((r) => r.name === remoteName);
  // 指定远程不存在：预检抛 INVALID_REF（与 CRUD 预检语义统一），
  // 不透出 git 的 '...does not appear to be a git repository' 500（P3-A 终审 Finding 2）
  if (remoteName !== undefined && targets.length === 0) {
    throw new ServiceError('INVALID_REF', `远程不存在：${remoteName}`, { context: { name: remoteName } });
  }
  const tokenByHost = new Map<string, string | null>();
  const entries = new Set<string>();
  let host: string | undefined;
  for (const remote of targets) {
    for (const url of [remote.fetchUrl, remote.pushUrl]) {
      const h = normalizeHost(url);
      host ??= h;
      if (!tokenByHost.has(h)) tokenByHost.set(h, findToken(h));
      const token = tokenByHost.get(h) ?? null;
      if (token === null) continue;
      // 同 host 不同端口/scheme 的 URL 各自成节；Set 去重（fetch/push URL 常相同）
      for (const entry of buildAuthConfig(url, token)) entries.add(entry);
    }
  }
  try {
    return await gitOp([...entries]);
  } catch (error) {
    if (error instanceof GitExitError && isAuthFailure(error.stderr)) {
      throw new ServiceError('AUTH_FAILED', '认证失败，请配置该主机的访问令牌', { context: { host } });
    }
    throw error;
  }
}

/** 远程列表：core 列表原样映射为 contracts 形状 */
export async function getRemotes(repoPath: string): Promise<RemoteList> {
  return { remotes: await listRemotes(repoPath) };
}

/** 远程写操作分派：add 重名 → INVALID_QUERY 远程已存在；remove/setUrl 不存在 → INVALID_REF 远程不存在；返回刷新列表 */
export async function applyRemoteAction(repoPath: string, action: RemoteAction): Promise<RemoteList> {
  const names = new Set((await listRemotes(repoPath)).map((r) => r.name));
  switch (action.action) {
    case 'add':
      if (names.has(action.name)) {
        throw new ServiceError('INVALID_QUERY', `远程已存在：${action.name}`, { context: { name: action.name } });
      }
      await addRemote(repoPath, action.name, action.url);
      break;
    case 'remove':
      if (!names.has(action.name)) {
        throw new ServiceError('INVALID_REF', `远程不存在：${action.name}`, { context: { name: action.name } });
      }
      await removeRemote(repoPath, action.name);
      break;
    case 'setUrl':
      if (!names.has(action.name)) {
        throw new ServiceError('INVALID_REF', `远程不存在：${action.name}`, { context: { name: action.name } });
      }
      await setRemoteUrl(repoPath, action.name, action.url);
      break;
  }
  return getRemotes(repoPath);
}

/** fetch：remote 缺省拉全部远程；返回发生移动的引用列表（走认证回路） */
export async function fetchRepo(repoPath: string, body: FetchBody): Promise<FetchResult> {
  return withAuth(repoPath, body.remote, (extraConfig) => fetchRemote(repoPath, { remote: body.remote, extraConfig }));
}

/** pull：remote 缺省取当前分支上游；rebase 对应 git pull --rebase（走认证回路） */
export async function pullRepo(repoPath: string, body: PullBody): Promise<PullOutcome> {
  return withAuth(repoPath, body.remote, (extraConfig) =>
    pullRemote(repoPath, { remote: body.remote, rebase: body.rebase, extraConfig }),
  );
}

/** push：rejected（non-fast-forward）为业务结果（status 'rejected' + 中文 hint），非错误（走认证回路） */
export async function pushRepo(repoPath: string, body: PushBody): Promise<PushOutcome> {
  return withAuth(repoPath, body.remote, (extraConfig) =>
    pushBranch(repoPath, {
      remote: body.remote,
      branch: body.branch,
      forceWithLease: body.forceWithLease,
      setUpstream: body.setUpstream,
      extraConfig,
    }),
  );
}
