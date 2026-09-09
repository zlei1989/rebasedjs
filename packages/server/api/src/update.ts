/**
 * Update Project 功能：一次「更新项目」= fetch 全远程 + 按 strategy 的 pull；
 * force-push 后修复（GitForcePushedBranchUpdateAction 语义）：fetch → 本地分支硬重置到远端上游 →
 * 把本地独有提交（@{u}..HEAD）逐一 cherry-pick 回来（冲突 → 冲突页流）。
 * fetch/pull 均经 remote.ts 的 withAuth 认证回路（token 注入 + AUTH_FAILED 识别）。
 */
import type { ForcePushedUpdateOutcome, UpdateBody, UpdateOutcome } from '@rebased/contracts';
import { getStatus, listLocalOnlyCommits, resetToRef } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import { assertNoOperationInProgress } from './operation';
import { cherryPick } from './pick';
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
  const pick = await cherryPick(repoPath, { hashes: localOnly });
  return { status: pick.status === 'conflicts' ? 'conflicts' : 'success', applied: localOnly };
}
