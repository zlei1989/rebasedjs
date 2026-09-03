/** 重置/撤销功能：ref 有效性预检（core verifyCommitish）→ core 原语执行 → 返回刷新状态。 */
import { resetToRef, verifyCommitish } from '@rebased/core';
import { ServiceError, type RepoStatus, type ResetBody } from '@rebased/contracts';
import { getRepoStatus } from './status';

/** 重置当前分支到 ref：ref 有效性预检（git rev-parse --verify <ref>^{commit}，失败 → ServiceError('INVALID_REF', '引用不存在或不是提交：…')）；执行后返回刷新状态 */
export async function applyReset(repoPath: string, body: ResetBody): Promise<RepoStatus> {
  if (!(await verifyCommitish(repoPath, body.ref))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${body.ref}`);
  }
  await resetToRef(repoPath, body.ref, body.mode);
  return getRepoStatus(repoPath);
}

/** 撤销最近提交（Undo Commit，对照 Java GitUncommitAction）：soft reset 到 HEAD~1；无父提交（根提交/无提交）→ ServiceError('INVALID_QUERY', '没有可撤销的提交')；返回刷新状态 */
export async function undoCommit(repoPath: string): Promise<RepoStatus> {
  if (!(await verifyCommitish(repoPath, 'HEAD~1'))) {
    throw new ServiceError('INVALID_QUERY', '没有可撤销的提交');
  }
  await resetToRef(repoPath, 'HEAD~1', 'soft');
  return getRepoStatus(repoPath);
}
