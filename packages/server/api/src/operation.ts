/** 进行中操作功能：core 操作原语 → contracts OperationState 的薄映射；无操作时中止抛 INVALID_QUERY。 */
import { abortGitOperation, getOperationState } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { OperationState } from '@rebased/contracts';

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
