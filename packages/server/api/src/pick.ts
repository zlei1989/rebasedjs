/**
 * 摘樱桃/还原功能：PickBody（hashes 数组）共用同一入口模式。
 * 发起前逐哈希 verifyCommitish 预检（无效引用用户早期修正，而非 git 半程失败）；
 * 摘樱桃另做 isAncestor 预检（祖先提交补丁为空 → 空补丁停态，见 core/pick.ts hasConflicts 注释，
 * 在 git 创建停态之前以 INVALID_QUERY 拦下——否则 UI 会陷入「继续」永远空补丁的死循环）；
 * 还原不拦祖先（还原祖先提交是 git 的正常用法，实测补丁非空且不产生停态——拦下会废掉还原主路径）。
 * 预检无进行中操作（与 rebase/merge 语义统一）。
 */
import { cherryPickCommits, isAncestor, revertCommits, verifyCommitish } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { PickBody, PickOutcome } from '@rebased/contracts';
import { assertNoOperationInProgress } from './operation';

/** 逐哈希有效性预检：任一无效即抛 INVALID_REF（先于 git 执行，避免中途失败留下半程操作态） */
async function verifyHashes(repoPath: string, hashes: string[]): Promise<void> {
  for (const hash of hashes) {
    if (!(await verifyCommitish(repoPath, hash))) {
      throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${hash}`);
    }
  }
}

/** 摘樱桃祖先预检：任一哈希已回到当前分支历史（祖先）即抛 INVALID_QUERY——祖先补丁必为空（见文件头） */
async function assertNotAncestor(repoPath: string, hashes: string[]): Promise<void> {
  for (const hash of hashes) {
    if (await isAncestor(repoPath, hash)) {
      throw new ServiceError('INVALID_QUERY', '该提交已在当前分支历史中，无需摘樱桃');
    }
  }
}

/** 摘樱桃：预检（无进行中操作 + 哈希有效 + 非祖先）→ core 多提交按序应用 → 两态结果透传 */
export async function cherryPick(repoPath: string, body: PickBody): Promise<PickOutcome> {
  await assertNoOperationInProgress(repoPath);
  await verifyHashes(repoPath, body.hashes);
  await assertNotAncestor(repoPath, body.hashes);
  return cherryPickCommits(repoPath, body.hashes);
}

/**
 * 重放本地独有提交（force-push 修复用）：跳过祖先/空补丁预检并以 `--empty=keep` 执行。
 * 与交互式摘樱桃的差别是语义性的：此处目标是「把本地独有提交原样搬回新基」，
 * 本地历史里的空提交（如 --allow-empty 占位提交）应被保留而不是中断整条重放（冒烟 D-22）。
 */
export async function replayLocalCommits(repoPath: string, hashes: string[]): Promise<PickOutcome> {
  await assertNoOperationInProgress(repoPath);
  await verifyHashes(repoPath, hashes);
  return cherryPickCommits(repoPath, hashes, { keepEmpty: true });
}

/** 还原：预检同 cherryPick（不含祖先拦截，理由见文件头）；Revert 提交语义（含冲突继续）由 core 处理 */
export async function revert(repoPath: string, body: PickBody): Promise<PickOutcome> {
  await assertNoOperationInProgress(repoPath);
  await verifyHashes(repoPath, body.hashes);
  return revertCommits(repoPath, body.hashes);
}
