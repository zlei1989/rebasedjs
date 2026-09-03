/** 合并功能：core mergeBranch/continueMerge → contracts 形状；发起前预检无进行中操作，冲突时附冲突列表，操作后返回刷新状态。 */
import { continueMerge, mergeBranch } from '@rebased/core';
import { ServiceError, type MergeBody, type MergeOutcome, type RepoStatus } from '@rebased/contracts';
import { getConflicts } from './conflict';
import { getOperation } from './operation';
import { getRepoStatus } from './status';

/**
 * 发起合并：预检无进行中操作（否则 core 会把 MERGE_HEAD 在场的二次合并误判为 conflicts）
 * → OPERATION_IN_PROGRESS；core mergeBranch 三分支状态 → 契约 MergeOutcome，
 * conflicts 时附带 getConflicts 列表；分支不存在等 git 失败透出 GitExitError（框架层折 GIT_ERROR）。
 */
export async function mergeBranchIntoCurrent(repoPath: string, body: MergeBody): Promise<MergeOutcome> {
  if ((await getOperation(repoPath)).kind !== 'none') {
    throw new ServiceError('OPERATION_IN_PROGRESS', '已有进行中的操作，请先完成或中止');
  }
  const result = await mergeBranch(repoPath, body);
  const conflicts = result.status === 'conflicts' ? (await getConflicts(repoPath)).conflicts : [];
  return { status: result.status, conflicts };
}

/**
 * 继续合并：预检 getOperation(repoPath).kind==='merge'（否则 INVALID_QUERY '当前没有进行中的合并'）；
 * squash/no-commit 等无 MERGE_HEAD 场景的退化提交由 core continueMerge 统一处理，api 只透传；
 * 完成后返回刷新状态。
 */
export async function continueMergeOperation(repoPath: string): Promise<RepoStatus> {
  if ((await getOperation(repoPath)).kind !== 'merge') {
    throw new ServiceError('INVALID_QUERY', '当前没有进行中的合并');
  }
  await continueMerge(repoPath);
  return getRepoStatus(repoPath);
}
