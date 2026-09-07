/**
 * worktree 功能：core 原语 → contracts 形状（P4-B 终审修复）。
 * getWorktrees：主工作树条目 path 与入参 repoPath realpath 相等（8.3 短名/斜杠差异）→
 * path 改写为 repoPath 原字符串（前端「当前」字符串比较保真；list/create/remove/prune 共享）；
 * create 预检（裁定顺序）：branch/newBranch 互斥且至少其一 → branch 存在性（listBranches）→
 * path 绝对且不在 repoPath 内（resolve+startsWith 防逃逸），父目录已存在时再 realpath 归一预拒
 * （恰等/大小写变体/8.3 变体，省 add+回滚）→ add 成功后重查列表：新建条目 realpath 与 repoPath
 * 全等/为前缀或在任一既有工作树之内 → 判定路径无效：回滚（core remove --force）→ INVALID_QUERY；
 * remove 预检：path===repoPath 拒绝，再查 path 在列表内（不在→直接 INVALID_QUERY 不调 core）；
 * 写操作后重查返回刷新列表；core 的 GitExitError → GIT_ERROR（stderr 首行）。
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  addWorktree,
  GitExitError,
  listBranches,
  listWorktrees,
  pruneWorktrees as corePruneWorktrees,
  removeWorktree as coreRemoveWorktree,
  type WorktreeEntry,
} from '@rebased/core';
import { ServiceError, type WorktreeCreateBody, type WorktreeList, type WorktreeRemoveBody } from '@rebased/contracts';

/** GitExitError → GIT_ERROR（中文前缀 + stderr 首行；其余错误类型取 message 兜底）——沿 gitlab 惯例 */
function gitFailure(prefix: string, error: unknown): ServiceError {
  const detail =
    error instanceof GitExitError
      ? (error.stderr.trim().split('\n')[0] ?? '')
      : error instanceof Error
        ? error.message
        : String(error);
  return new ServiceError('GIT_ERROR', `${prefix}：${detail}`, { cause: error });
}

/** 路径等价比较：git 输出 realpath 长形式，候选可能为 8.3 短形式——OS 级归一；缺失目录回退 resolve */
function pathsEqual(a: string, b: string): boolean {
  try {
    return realpathSync.native(a) === realpathSync.native(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

/** 尽力 realpath：存在 → OS 归一（大小写/8.3/斜杠差异消解）；缺失 → resolve 归一（前缀比较的回落） */
function realPathOf(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

/** 主工作树路径改写：条目 path 与 repoPath realpath 相等 → path 改为 repoPath 原字符串（保留入参形式） */
function rewriteMainWorktreePath(entry: WorktreeEntry, repoPath: string): WorktreeEntry {
  return pathsEqual(entry.path, repoPath) ? { ...entry, path: repoPath } : entry;
}

export async function getWorktrees(repoPath: string): Promise<WorktreeList> {
  return { worktrees: (await listWorktrees(repoPath)).map((w) => rewriteMainWorktreePath(w, repoPath)) };
}

/** 创建：预检（互斥 → 分支存在性 → 路径）→ core add → 重查 */
export async function createWorktree(repoPath: string, body: WorktreeCreateBody): Promise<WorktreeList> {
  // 互斥且至少其一（同给或都缺都拒绝；同给时先于分支存在性报错，裁定预检顺序）
  if ((body.branch === undefined) === (body.newBranch === undefined)) {
    throw new ServiceError('INVALID_QUERY', '需指定分支或新分支（二选一）');
  }
  if (body.branch !== undefined) {
    const branches = await listBranches(repoPath);
    if (!branches.some((b) => b.name === body.branch)) {
      throw new ServiceError('INVALID_REF', `分支不存在：${body.branch}`);
    }
  }
  // 路径须绝对且在仓库目录之外（在 repoPath 内 / 经 .. 归一化落回 repoPath 内 → 无效；防逃逸先例同 patch/shelf）
  const base = resolve(repoPath);
  if (!isAbsolute(body.path) || resolve(body.path).startsWith(base + sep)) {
    throw new ServiceError('INVALID_QUERY', `路径无效：${body.path}`);
  }
  // 前置归一（终审裁定采纳）：目标父目录已存在 → realpath 父目录再拼 basename 归一比较——
  // 恰等 repoPath（T3 M1）与大小写/8.3 变体的「在仓库内」在 add 前即拒（省一次 add+回滚）；
  // 父目录不存在（深度多级）时留给 add 后归一校验兜底
  const baseReal = realPathOf(repoPath);
  const parentReal = (() => {
    try {
      return realpathSync.native(dirname(body.path));
    } catch {
      return null;
    }
  })();
  if (parentReal !== null) {
    const candidateReal = realPathOf(join(parentReal, basename(body.path)));
    if (candidateReal === baseReal || candidateReal.startsWith(baseReal + sep) || baseReal.startsWith(candidateReal + sep)) {
      throw new ServiceError('INVALID_QUERY', `路径无效：${body.path}`);
    }
  }
  try {
    await addWorktree(repoPath, body.path, { branch: body.branch, newBranch: body.newBranch });
  } catch (error) {
    throw gitFailure('创建工作树失败', error);
  }
  // add 成功后重查：新建条目（path 与请求 body.path realpath 相等）做 realpath 归一校验——
  // 其 realpath 与 repoPath 全等/为前缀（父目录缺失时前述预拒未覆盖，如多级变体），或落在任一
  // 既有工作树（主/副）realpath 之内（副工作树目录内嵌套——git 不拒但语义非法）→ 判定路径无效：
  // 回滚（core remove --force）→ INVALID_QUERY（前一 add 已成功后绝不残留条目）
  const list = await listWorktrees(repoPath);
  const created = list.find((w) => pathsEqual(w.path, body.path));
  if (created !== undefined) {
    const createdReal = realPathOf(created.path);
    const invalid =
      createdReal === baseReal ||
      baseReal.startsWith(createdReal + sep) ||
      list.some((w) => w !== created && createdReal.startsWith(realPathOf(w.path) + sep));
    if (invalid) {
      await coreRemoveWorktree(repoPath, created.path, { force: true });
      throw new ServiceError('INVALID_QUERY', `路径无效：${body.path}`);
    }
  }
  return { worktrees: list.map((w) => rewriteMainWorktreePath(w, repoPath)) };
}

/** 移除：path===repoPath 拒绝 → 预检在列表内 → core remove（force 透传）→ 重查 */
export async function removeWorktree(repoPath: string, body: WorktreeRemoveBody): Promise<WorktreeList> {
  if (pathsEqual(body.path, repoPath)) {
    throw new ServiceError('INVALID_QUERY', '不能移除当前工作树');
  }
  const existing = await listWorktrees(repoPath);
  if (!existing.some((w) => pathsEqual(w.path, body.path))) {
    throw new ServiceError('INVALID_QUERY', `工作树不存在：${body.path}`);
  }
  try {
    await coreRemoveWorktree(repoPath, body.path, { force: body.force });
  } catch (error) {
    throw gitFailure('移除工作树失败', error);
  }
  return getWorktrees(repoPath);
}

/** 清理陈旧条目：core prune + 重查 */
export async function pruneWorktrees(repoPath: string): Promise<WorktreeList> {
  try {
    await corePruneWorktrees(repoPath);
  } catch (error) {
    throw gitFailure('清理工作树失败', error);
  }
  return getWorktrees(repoPath);
}
