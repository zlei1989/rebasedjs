/**
 * remote 原语：远程 CRUD、fetch/pull/push、浅克隆检测。
 * - fetch 的 updatedRefs 走 refs.ts 快照 before/after diff（与 watcher 指纹同源，不解析 -v 输出——输出格式随版本漂移）；
 * - pull 的 up-to-date/updated 以 HEAD 哈希前后对比判定（LC_ALL=C 虽固定英文，哈希对比连 rebase 改写也可检出）；
 * - pull 冲突检测复用 operation/conflict 原语；push rejected 检测用 LC_ALL=C 下固定的英文 stderr 特征。
 */
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';
import { listConflictedPaths } from './conflict';
import { diffRefsSnapshots, takeRefsSnapshot } from './refs';

export interface CoreRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/**
 * 传输操作（fetch/pull/push）的统一超时兜底：120s。
 * GIT_TERMINAL_PROMPT/GCM_INTERACTIVE 只关闭凭据提示类挂起；网络停滞类（TCP 连上无字节、
 * 代理/VPN 异常）仍会无限挂起 HTTP 请求并泄漏 git 进程，故传输调用一律带超时，
 * 超时经 exec.ts 既有 124 退出码路径以 GitExitError 透出（上层折 GIT_ERROR）。
 * 各原语 opts.timeoutMs 可覆盖该默认值（测试用小值真实触发 124 路径）。
 */
const TRANSFER_TIMEOUT_MS = 120_000;

/** 远程列表：git remote -v 解析（同名 fetch/push 两行聚合；缺 push 行时 pushUrl=fetchUrl） */
export async function listRemotes(cwd: string): Promise<CoreRemote[]> {
  const { stdout } = await runGit(['remote', '-v'], { cwd });
  const byName = new Map<string, CoreRemote>();
  // 行形如 "origin\thttps://example.com/a.git (fetch)"；名称/URL 不含空白（git 远程名与 URL 均不支持空格）
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\S+)\t(\S+) \((fetch|push)\)$/);
    if (m === null) continue;
    const [, name, url, kind] = m;
    let entry = byName.get(name);
    if (entry === undefined) {
      entry = { name, fetchUrl: '', pushUrl: '' };
      byName.set(name, entry);
    }
    if (kind === 'fetch') entry.fetchUrl = url;
    else entry.pushUrl = url;
  }
  for (const entry of byName.values()) {
    if (entry.pushUrl === '') entry.pushUrl = entry.fetchUrl;
  }
  return [...byName.values()];
}

export async function addRemote(cwd: string, name: string, url: string): Promise<void> {
  await runGit(['remote', 'add', name, url], { cwd });
}

export async function removeRemote(cwd: string, name: string): Promise<void> {
  await runGit(['remote', 'remove', name], { cwd });
}

export async function setRemoteUrl(cwd: string, name: string, url: string): Promise<void> {
  await runGit(['remote', 'set-url', name, url], { cwd });
}

/**
 * fetch：git fetch [--all 或指定远程 [refspec]]；返回发生移动（含新增/删除）的引用完整 refname 列表。
 * 判定方式：fetch 前后各取一次 refs 快照做 diff（复用 watcher 指纹原语）。
 * refspec 仅与显式 remote 组合（无 remote 时 --all 与 refspec 语义互斥，抛错拒绝）。
 */
export async function fetchRemote(
  cwd: string,
  opts: { remote?: string; refspec?: string; extraConfig?: string[]; timeoutMs?: number },
): Promise<{ updatedRefs: string[] }> {
  if (opts.refspec !== undefined && opts.remote === undefined) {
    throw new Error('fetchRemote: refspec 需要显式 remote（refspec 与 --all 互斥）');
  }
  const before = await takeRefsSnapshot(cwd);
  const args = ['fetch'];
  if (opts.remote !== undefined) args.push(opts.remote);
  else args.push('--all');
  if (opts.refspec !== undefined) args.push(opts.refspec);
  await runGit(args, { cwd, extraConfig: opts.extraConfig, timeoutMs: opts.timeoutMs ?? TRANSFER_TIMEOUT_MS });
  const after = await takeRefsSnapshot(cwd);
  return { updatedRefs: diffRefsSnapshots(before, after) };
}

/** HEAD 哈希（无提交的空仓库返回 null） */
async function headHash(cwd: string): Promise<string | null> {
  try {
    return (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
  } catch {
    return null;
  }
}

/** 冲突判定：operation 原语见进行中的 merge/rebase，或 ls-files -u 存在未合并路径 */
async function hasConflicts(cwd: string): Promise<boolean> {
  const op = await getOperationState(cwd);
  if (op.kind !== 'none') return true;
  return (await listConflictedPaths(cwd)).length > 0;
}

/**
 * pull：git pull [--rebase] [remote]。
 * - 冲突：git 非零退出且 operation/conflict 原语确认 → 'conflicts'（merge/rebase 状态留给调用方处理）；
 * - 其余非零退出原样抛 GitExitError；
 * - 成功时以 HEAD 哈希前后对比区分 'up-to-date' / 'updated'。
 */
export async function pullRemote(
  cwd: string,
  opts: { remote?: string; rebase?: boolean; extraConfig?: string[]; timeoutMs?: number },
): Promise<{ status: 'up-to-date' | 'updated' | 'conflicts' }> {
  const before = await headHash(cwd);
  const args = ['pull'];
  if (opts.rebase === true) args.push('--rebase');
  if (opts.remote !== undefined) args.push(opts.remote);
  try {
    await runGit(args, { cwd, extraConfig: opts.extraConfig, timeoutMs: opts.timeoutMs ?? TRANSFER_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof GitExitError && (await hasConflicts(cwd))) return { status: 'conflicts' };
    throw err;
  }
  const after = await headHash(cwd);
  return { status: before === after ? 'up-to-date' : 'updated' };
}

/**
 * push：git push [-u] [--force-with-lease] [remote] [branch]（branch 省略时推当前分支）。
 * - 'up-to-date' 判定：'Everything up-to-date' 为信息性输出，版本间落 stdout/stderr 不一，两处都查；
 * - rejected（non-fast-forward）：stderr 含 'rejected' 且含 'non-fast-forward'/'fetch first' →
 *   业务结果 'rejected' + 中文引导 hint（非错误，上层按 200 透出）；
 * - 其余失败（无远程、认证失败等）原样抛 GitExitError。
 */
export async function pushBranch(
  cwd: string,
  opts: { remote?: string; branch?: string; forceWithLease?: boolean; setUpstream?: boolean; extraConfig?: string[]; timeoutMs?: number },
): Promise<{ status: 'pushed' | 'rejected' | 'up-to-date'; hint?: string }> {
  const args = ['push'];
  if (opts.setUpstream === true) args.push('-u');
  if (opts.forceWithLease === true) args.push('--force-with-lease');
  if (opts.remote !== undefined) args.push(opts.remote);
  if (opts.branch !== undefined) args.push(opts.branch);
  try {
    const { stdout, stderr } = await runGit(args, { cwd, extraConfig: opts.extraConfig, timeoutMs: opts.timeoutMs ?? TRANSFER_TIMEOUT_MS });
    const upToDate = stdout.includes('Everything up-to-date') || stderr.includes('Everything up-to-date');
    return { status: upToDate ? 'up-to-date' : 'pushed' };
  } catch (err) {
    if (
      err instanceof GitExitError &&
      err.stderr.includes('rejected') &&
      (err.stderr.includes('non-fast-forward') || err.stderr.includes('fetch first'))
    ) {
      return { status: 'rejected', hint: '远端有更新的提交，请先拉取/变基' };
    }
    throw err;
  }
}

/** 浅克隆检测：git rev-parse --is-shallow-repository（输出 'true'/'false'） */
export async function isShallowRepo(cwd: string): Promise<boolean> {
  const { stdout } = await runGit(['rev-parse', '--is-shallow-repository'], { cwd });
  return stdout.trim() === 'true';
}
