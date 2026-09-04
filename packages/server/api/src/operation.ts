/** 进行中操作功能：core 操作原语 → contracts OperationState 的薄映射；无操作时中止抛 INVALID_QUERY。 */
import { abortGitOperation, canContinueMerge, continueMerge, continuePick, continueRebase, getOperationState } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { OperationState, RepoStatus } from '@rebased/contracts';
import { getRepoStatus } from './status';

export async function getOperation(repoPath: string): Promise<OperationState> {
  const s = await getOperationState(repoPath);
  return { kind: s.kind, step: s.step, total: s.total };
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
