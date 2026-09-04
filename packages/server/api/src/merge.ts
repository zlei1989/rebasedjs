/** 合并功能：core mergeBranch/continueMerge → contracts 形状；发起前预检无进行中操作，冲突时附冲突列表，操作后返回刷新状态。 */
import { canContinueMerge, continueMerge, mergeBranch } from '@rebased/core';
import { ServiceError, type MergeBody, type MergeOutcome, type RepoStatus } from '@rebased/contracts';
import { getConflicts } from './conflict';
import { assertNoOperationInProgress } from './operation';
import { getRepoStatus } from './status';

/**
 * 发起合并：预检无进行中操作（否则 core 会把 MERGE_HEAD 在场的二次合并误判为 conflicts）
 * → OPERATION_IN_PROGRESS；core mergeBranch 三分支状态 → 契约 MergeOutcome，
 * conflicts 时附带 getConflicts 列表；分支不存在等 git 失败透出 GitExitError（框架层折 GIT_ERROR）。
 */
export async function mergeBranchIntoCurrent(repoPath: string, body: MergeBody): Promise<MergeOutcome> {
  await assertNoOperationInProgress(repoPath);
  const result = await mergeBranch(repoPath, body);
  const conflicts = result.status === 'conflicts' ? (await getConflicts(repoPath)).conflicts : [];
  return { status: result.status, conflicts };
}

/**
 * 继续合并：预检 core canContinueMerge（合并态或 squash 信息文件在场；否则 INVALID_QUERY
 * '当前没有进行中的合并'）——squash 不进合并态，仅看操作态会把 core 的退化提交路径拦成死代码；
 * 退化提交由 core continueMerge 统一处理，api 只透传；完成后返回刷新状态。
 */
export async function continueMergeOperation(repoPath: string): Promise<RepoStatus> {
  if (!(await canContinueMerge(repoPath))) {
    throw new ServiceError('INVALID_QUERY', '当前没有进行中的合并');
  }
  await continueMerge(repoPath);
  return getRepoStatus(repoPath);
}
