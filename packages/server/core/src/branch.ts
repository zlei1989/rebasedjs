/**
 * branch 原语：分支列表与分支写操作。
 * 列表用 for-each-ref 一次取 refs/heads + refs/remotes 全字段（NUL 分隔，任意分支名安全）；
 * 符号引用（origin/HEAD 类）经 %(symref) 非空过滤。
 */
import { runGit } from './exec';

export interface CoreBranch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hash: string;
  lastCommitIso: string;
}

/**
 * 7 字段格式：完整 refname / upstream 短名 / upstream 轨道 / objectname / committerdate(iso-strict) / HEAD 标记 / symref 目标。
 * 用完整 %(refname) 而非 %(refname:short)：refs/heads|remotes 前缀是判定 remote 的唯一可靠依据
 * （本地分支也可含斜杠，短名无法区分），short 名由剥离前缀得到，与 refname:short 语义一致。
 */
const BRANCH_FORMAT = ['%(refname)', '%(upstream:short)', '%(upstream:track)', '%(objectname)', '%(committerdate:iso-strict)', '%(HEAD)', '%(symref)'].join(
  '%00',
);

/** 解析 upstream:track 文本（LC_ALL=C 固定为英文）："[ahead 2, behind 1]" / "[ahead 2]" / "[gone]" / "" */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = track.match(/ahead (\d+)/);
  const behind = track.match(/behind (\d+)/);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}

/** 分支列表：for-each-ref 一次取 refs/heads + refs/remotes 全字段（NUL 分隔安全）；不含 mergedIntoHead（api 层组合 --merged 结果） */
export async function listBranches(cwd: string): Promise<CoreBranch[]> {
  const { stdout } = await runGit(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'], { cwd });
  const branches: CoreBranch[] = [];
  // 行内 NUL 分隔字段、行间 \n（字段值均不含换行：refname/hash 受 git 约束，date/HEAD 为定形输出）
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const [refname, upstream, track, hash, dateIso, head, symref] = line.split('\0');
    // 符号引用（如 refs/remotes/origin/HEAD → symref 指向真实目标）：跳过，目标 ref 自身已在列表中
    if (symref !== '') continue;
    const remote = refname.startsWith('refs/remotes/');
    const { ahead, behind } = parseTrack(track);
    branches.push({
      name: refname.replace(/^refs\/(heads|remotes)\//, ''),
      remote,
      current: head === '*',
      upstream: upstream === '' ? null : upstream,
      ahead,
      behind,
      hash,
      lastCommitIso: dateIso,
    });
  }
  return branches;
}

/** 已合并入 ref 的本地分支名集合（git branch --merged）；ref 省略为 HEAD */
export async function mergedBranchNames(cwd: string, ref?: string): Promise<string[]> {
  // --format 须置于 --merged 之前：--merged 会把紧随其后的参数当作 ref 吞掉
  const args = ['branch', '--format=%(refname:short)', '--merged'];
  if (ref !== undefined) args.push(ref);
  const { stdout } = await runGit(args, { cwd });
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** 当前分支名（git symbolic-ref --short HEAD）：分离头指针/空仓库返回 null */
export async function currentBranchName(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd });
    return stdout.trim() === '' ? null : stdout.trim();
  } catch {
    return null;
  }
}

/**
 * 最近检出分支（GitRecentCheckoutBranches 语义）：reflog 的 checkout: 记录（--grep-reflog 过滤，limit 条），
 * 每条取最后一次 " to <分支名>" 之后的分支名（最近优先）；仅保留仍存在的本地分支并去重保序。
 * 克隆初始检出不产 checkout 记录（Java 以项目设置兜底——Web 无对应，缺失即不计）。
 */
export async function listRecentCheckoutBranches(cwd: string, limit = 50): Promise<string[]> {
  const { stdout } = await runGit(
    ['reflog', '--max-count', String(limit), '--grep-reflog', 'checkout:', '--format=%gs'],
    { cwd },
  );
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const toIndex = line.lastIndexOf(' to ');
    if (toIndex <= 0) continue;
    const name = line.slice(toIndex + ' to '.length).trim();
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  // 只保留仍存在的本地分支（对齐 Java haveLocalBranch）
  const locals = new Set((await listBranches(cwd)).filter((b) => !b.remote).map((b) => b.name));
  return names.filter((n) => locals.has(n));
}

export async function createBranch(cwd: string, name: string, startPoint?: string): Promise<void> {
  const args = ['branch', name];
  if (startPoint !== undefined) args.push(startPoint);
  await runGit(args, { cwd });
}

/** 删除分支：force 用 -D 强删未合并分支；删除当前分支由 git 拒绝并以 GitExitError 透出（符合预期） */
export async function deleteBranch(cwd: string, name: string, force?: boolean): Promise<void> {
  await runGit(['branch', force ? '-D' : '-d', name], { cwd });
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await runGit(['branch', '-m', oldName, newName], { cwd });
}

export async function setBranchUpstream(cwd: string, name: string, upstream: string): Promise<void> {
  await runGit(['branch', '--set-upstream-to', upstream, name], { cwd });
}
