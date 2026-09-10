/**
 * Update Project 功能：一次「更新项目」= fetch 全远程 + 按 strategy 的 pull；
 * force-push 后修复（GitForcePushedBranchUpdateAction 语义）：fetch → 本地分支硬重置到远端上游 →
 * 把本地独有提交（@{u}..HEAD）逐一 cherry-pick 回来（冲突 → 冲突页流）；
 * 检出并更新（GitCheckoutWithUpdateAction 语义）：检出本地分支 → 策略化更新（merge/rebase）。
 * fetch/pull 均经 remote.ts 的 withAuth 认证回路（token 注入 + AUTH_FAILED 识别）。
 */
import type { CheckoutUpdateBody, ForcePushedUpdateOutcome, RebaseOutcome, UpdateBody, UpdateOutcome } from '@rebased/contracts';
import { checkoutWithUpdate, getStatus, listBranches, listLocalOnlyCommits, resetToRef } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import { assertNoOperationInProgress } from './operation';
import { replayLocalCommits } from './pick';
import { fetchRepo, pullRepo } from './remote';

/** Update Project：fetch 全远程 + 按 strategy 的 pull（merge=git pull / rebase=git pull --rebase） */
export async function updateProject(repoPath: string, body: UpdateBody): Promise<UpdateOutcome> {
  const { updatedRefs } = await fetchRepo(repoPath, {});
  const pull = await pullRepo(repoPath, { rebase: body.strategy === 'rebase' });
  return { fetched: updatedRefs, pull };
}

/**
 * force-push 后修复（GitForcePushedBranchUpdateAction 语义）：远端被强推后本地分支与上游分叉
 * （ahead 与 behind 同时非零，无法普通 pull 快进/合并出的干净历史）——本操作：
 * 1) 预检无进行中操作 + 当前分支有上游（INVALID_QUERY）；
 * 2) fetch 全远程（认证回路）；
 * 3) 记录本地独有提交（@{u}..HEAD，旧→新）；
 * 4) hard-reset 当前分支到上游（fetch 后 = 远端头）；
 * 5) 无独有提交 → {status:'updated', applied:[]}（重置即快进等价）；
 *    有独有提交 → 逐一 cherry-pick 重放（冲突 → 'conflicts' 交冲突页，continue/abort/skip 流与摘樱桃一致）。
 */
export async function forcePushedUpdate(repoPath: string): Promise<ForcePushedUpdateOutcome> {
  await assertNoOperationInProgress(repoPath);
  const status = await getStatus(repoPath);
  if (status.branch === null || status.upstream === null) {
    throw new ServiceError('INVALID_QUERY', '当前分支没有上游，无法执行 force-push 修复（先推送建立上游）');
  }
  await fetchRepo(repoPath, {});
  const localOnly = await listLocalOnlyCommits(repoPath);
  const upstream = status.upstream;
  await resetToRef(repoPath, upstream, 'hard');
  if (localOnly.length === 0) {
    return { status: 'updated', applied: [] };
  }
  // 重放走 replayLocalCommits（--empty=keep）：本地独有提交里的空提交（--allow-empty 占位等）
  // 必须被保留，否则 git 在首个空提交处中止，本地分支卡在重放中途（冒烟 D-22）
  const pick = await replayLocalCommits(repoPath, localOnly);
  return { status: pick.status === 'conflicts' ? 'conflicts' : 'success', applied: localOnly };
}

/**
 * 检出并更新（GitCheckoutWithUpdateAction 语义：Checkout and Update）：预检无进行中操作 + 本地分支存在
 * （INVALID_REF，远程引用名不适用——动作仅面向本地分支）+ 非当前分支（INVALID_QUERY）+ 已配置上游
 * （INVALID_QUERY）；core 检出 → 策略化 pull（fetch 跟踪分支 + merge/`--rebase`）；updated → 'success'
 * （与变基/更新成功口径一致）；conflicts → 冲突页流。
 */
export async function checkoutUpdate(repoPath: string, body: CheckoutUpdateBody): Promise<RebaseOutcome> {
  await assertNoOperationInProgress(repoPath);
  const branches = await listBranches(repoPath);
  const target = branches.find((b) => !b.remote && b.name === body.branch);
  if (target === undefined) {
    throw new ServiceError('INVALID_REF', `分支不存在：${body.branch}`);
  }
  if (target.current) {
    throw new ServiceError('INVALID_QUERY', '目标已是当前分支，无需检出并更新');
  }
  if (target.upstream === null) {
    throw new ServiceError('INVALID_QUERY', '分支未配置上游，无法检出并更新');
  }
  const result = await checkoutWithUpdate(repoPath, { branch: target.name, rebase: body.strategy === 'rebase' });
  return { status: result.status === 'updated' ? 'success' : result.status };
}
