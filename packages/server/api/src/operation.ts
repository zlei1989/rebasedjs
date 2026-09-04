/** 进行中操作功能：core 操作原语 → contracts OperationState 的薄映射；无操作时中止抛 INVALID_QUERY。 */
import { abortGitOperation, canContinueMerge, continueMerge, continuePick, continueRebase, getOperationState } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { OperationState, RepoStatus } from '@rebased/contracts';
import { getRepoStatus } from './status';

export async function getOperation(repoPath: string): Promise<OperationState> {
  const s = await getOperationState(repoPath);
  return { kind: s.kind, step: s.step, total: s.total };
}

/**
 * 预检无进行中操作（→ OPERATION_IN_PROGRESS）：merge/rebase/cherry-pick/revert 发起类操作共用。
 * 操作态在场说明上次操作未收尾，直接发起会产生嵌套操作或让 core 把既有操作态误判为冲突结果。
 */
export async function assertNoOperationInProgress(repoPath: string): Promise<void> {
  if ((await getOperation(repoPath)).kind !== 'none') {
    throw new ServiceError('OPERATION_IN_PROGRESS', '已有进行中的操作，请先完成或中止');
  }
}

export async function abortOperation(repoPath: string): Promise<OperationState> {
  const current = await getOperation(repoPath);
  if (current.kind === 'none') {
    throw new ServiceError('INVALID_QUERY', '当前没有进行中的操作');
  }
  await abortGitOperation(repoPath, current.kind);
  return getOperation(repoPath); // 中止后返回刷新状态
}

/**
 * 继续进行中操作：按 operation.kind 分派（merge → core continueMerge；rebase → continueRebase；
 * cherry-pick/revert → continuePick）。kind none 但 squash 信息文件在场（canContinueMerge）时
 * 走 merge 的退化提交路径——merge --squash 从不写操作态标记，单看 kind 会把这个合法继续拦成
 * INVALID_QUERY；两者皆无 → INVALID_QUERY '当前没有可继续的操作'。成功后返回刷新状态。
 */
export async function continueOperation(repoPath: string): Promise<RepoStatus> {
  const op = await getOperation(repoPath);
  switch (op.kind) {
    case 'merge':
      await continueMerge(repoPath);
      break;
    case 'rebase':
      await continueRebase(repoPath);
      break;
    case 'cherry-pick':
    case 'revert':
      await continuePick(repoPath, op.kind);
      break;
    case 'none':
      if (!(await canContinueMerge(repoPath))) {
        throw new ServiceError('INVALID_QUERY', '当前没有可继续的操作');
      }
      await continueMerge(repoPath); // squash 退化：无 MERGE_HEAD，core 以 commit --no-edit 收尾
      break;
  }
  return getRepoStatus(repoPath);
}
