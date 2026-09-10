/** 分支功能：core 分支原语 → contracts 形状；写操作前校验目标分支存在，操作后返回刷新列表。 */
import {
  createBranch,
  deleteBranch,
  listBranches,
  listRecentCheckoutBranches,
  listWorktrees,
  mergedBranchNames,
  renameBranch,
  setBranchUpstream,
  type CoreBranch,
} from '@rebased/core';
import { ServiceError, type BranchAction, type BranchList, type BranchRef } from '@rebased/contracts';

/** CoreBranch → BranchRef：组合 --merged 名单得 mergedIntoHead；
 *  名单含本地短名与远程全名（origin/x，见 core mergedBranchNames），故远程分支同样参与判定——
 *  仅按本地判定会让「仅看已合并」把全部远程分支隐藏（冒烟 D-19）。
 *  checkedOutInWorktree：该分支已被某 worktree 检出（git branch -d 会拒绝），供清理入口排除 */
function toBranchRef(b: CoreBranch, merged: Set<string>, worktreeBranches: Set<string>): BranchRef {
  return {
    ...b,
    mergedIntoHead: merged.has(b.name),
    ...(worktreeBranches.has(b.name) ? { checkedOutInWorktree: true } : {}),
  };
}

/** 本地分支存在性校验（delete/rename/setUpstream 的前置）：不存在 → INVALID_REF */
async function requireLocalBranch(repoPath: string, name: string): Promise<void> {
  const branches = await listBranches(repoPath);
  if (!branches.some((b) => !b.remote && b.name === name)) {
    throw new ServiceError('INVALID_REF', `分支不存在：${name}`);
  }
}

/** 分支列表：core 列表 + mergedBranchNames 组合 mergedIntoHead 标志 + 最近检出（reflog）
 *  + worktree 占用标记（清理已合并据此排除不可删分支） */
export async function getBranches(repoPath: string): Promise<BranchList> {
  const [branches, merged, recent, worktrees] = await Promise.all([
    listBranches(repoPath),
    mergedBranchNames(repoPath),
    listRecentCheckoutBranches(repoPath),
    listWorktrees(repoPath),
  ]);
  const mergedSet = new Set(merged);
  const worktreeBranches = new Set(worktrees.map((w) => w.branch).filter((b): b is string => b !== null));
  return { branches: branches.map((b) => toBranchRef(b, mergedSet, worktreeBranches)), recent };
}

/** 分支写操作分派：create/delete/rename/setUpstream → core；delete/rename/setUpstream 前校验目标分支存在；返回刷新列表 */
export async function applyBranchAction(repoPath: string, action: BranchAction): Promise<BranchList> {
  switch (action.action) {
    case 'create':
      await createBranch(repoPath, action.name, action.startPoint);
      break;
    case 'delete':
      await requireLocalBranch(repoPath, action.name);
      await deleteBranch(repoPath, action.name, action.force);
      break;
    case 'rename':
      await requireLocalBranch(repoPath, action.oldName);
      await renameBranch(repoPath, action.oldName, action.newName);
      break;
    case 'setUpstream':
      await requireLocalBranch(repoPath, action.name);
      await setBranchUpstream(repoPath, action.name, action.upstream);
      break;
  }
  return getBranches(repoPath);
}
