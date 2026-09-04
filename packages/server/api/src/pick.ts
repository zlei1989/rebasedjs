/**
 * 摘樱桃/还原功能：PickBody（hashes 数组）共用同一入口模式。
 * 发起前逐哈希 verifyCommitish 预检（无效引用用户早期修正，而非 git 半程失败）；
 * 预检无进行中操作（与 rebase/merge 语义统一）。
 */
import { cherryPickCommits, revertCommits, verifyCommitish } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { PickBody, PickOutcome } from '@rebased/contracts';
import { getOperation } from './operation';

/** 预检无进行中操作（→ OPERATION_IN_PROGRESS） */
async function assertNoOperationInProgress(repoPath: string): Promise<void> {
  if ((await getOperation(repoPath)).kind !== 'none') {
    throw new ServiceError('OPERATION_IN_PROGRESS', '已有进行中的操作，请先完成或中止');
  }
}

/** 逐哈希有效性预检：任一无效即抛 INVALID_REF（先于 git 执行，避免中途失败留下半程操作态） */
async function verifyHashes(repoPath: string, hashes: string[]): Promise<void> {
  for (const hash of hashes) {
    if (!(await verifyCommitish(repoPath, hash))) {
      throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${hash}`);
    }
  }
}

/** 摘樱桃：预检（无进行中操作 + 哈希有效）→ core 多提交按序应用 → 两态结果透传 */
export async function cherryPick(repoPath: string, body: PickBody): Promise<PickOutcome> {
  await assertNoOperationInProgress(repoPath);
  await verifyHashes(repoPath, body.hashes);
  return cherryPickCommits(repoPath, body.hashes);
}

/** 还原：预检同 cherryPick；Revert 提交语义（含冲突继续）由 core 处理 */
export async function revert(repoPath: string, body: PickBody): Promise<PickOutcome> {
  await assertNoOperationInProgress(repoPath);
  await verifyHashes(repoPath, body.hashes);
  return revertCommits(repoPath, body.hashes);
}
