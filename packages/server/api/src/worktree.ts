/**
 * worktree 功能：core 原语 → contracts 形状。
 * create 预检（裁定顺序）：branch/newBranch 互斥且至少其一 → branch 存在性（listBranches）→
 * path 绝对且不在 repoPath 内（resolve+startsWith 防逃逸，沿 patch/shelf 先例）；
 * remove 预检：path===repoPath 拒绝，再查 path 在列表内（不在→直接 INVALID_QUERY 不调 core）；
 * 写操作后重查返回刷新列表；core 的 GitExitError → GIT_ERROR（stderr 首行）。
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import {
  addWorktree,
  GitExitError,
  listBranches,
  listWorktrees,
  pruneWorktrees as corePruneWorktrees,
  removeWorktree as coreRemoveWorktree,
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

export async function getWorktrees(repoPath: string): Promise<WorktreeList> {
  return { worktrees: await listWorktrees(repoPath) };
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
  try {
    await addWorktree(repoPath, body.path, { branch: body.branch, newBranch: body.newBranch });
  } catch (error) {
    throw gitFailure('创建工作树失败', error);
  }
  return getWorktrees(repoPath);
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
