/**
 * 变基功能：onto 变基、todo 数据源、交互式变基（清单全量校验）。
 * 发起类操作预检无进行中操作（避免 core 把既有操作态误判为冲突结果）；
 * 交互式 todo 的 entries 与仓库实际 base..HEAD 提交做全量哈希比对——防错基/漏改的静默脏数据。
 */
import { listTodoCommits, rebaseOnto, runInteractiveRebase, verifyCommitish } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { InteractiveRebaseBody, RebaseBody, RebaseOutcome, TodoEntry } from '@rebased/contracts';
import { getOperation } from './operation';

/** 预检无进行中操作：操作态在场说明上次操作未收尾，直接发起会产生嵌套操作（→ OPERATION_IN_PROGRESS） */
async function assertNoOperationInProgress(repoPath: string): Promise<void> {
  if ((await getOperation(repoPath)).kind !== 'none') {
    throw new ServiceError('OPERATION_IN_PROGRESS', '已有进行中的操作，请先完成或中止');
  }
}

/** rebase onto：预检无进行中操作 + onto 有效性（verifyCommitish → INVALID_REF）；core 三分支状态透传 */
export async function rebaseBranch(repoPath: string, body: RebaseBody): Promise<RebaseOutcome> {
  await assertNoOperationInProgress(repoPath);
  if (!(await verifyCommitish(repoPath, body.onto))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${body.onto}`);
  }
  return rebaseOnto(repoPath, { onto: body.onto, branch: body.branch });
}

/** 交互式变基 todo 数据源：core 反序（旧→新）返回 base..HEAD 全量提交；base 无效由 git 报错透出（框架层折 GIT_ERROR） */
export async function getRebaseTodo(repoPath: string, base: string): Promise<TodoEntry[]> {
  return listTodoCommits(repoPath, base);
}

/**
 * 交互式变基：预检无进行中操作；entries 哈希与 listTodoCommits 做全量（多重集）比对——
 * 排序后逐项相等即 缺/多/重复 全灭（任一不符 → INVALID_QUERY '提交清单与仓库实际不符'），
 * 通过后 core 以 sequence-editor shim 执行（drop/squash 等结构变更由 git 完成）。
 */
export async function runInteractiveRebaseService(repoPath: string, body: InteractiveRebaseBody): Promise<RebaseOutcome> {
  await assertNoOperationInProgress(repoPath);
  const actual = (await listTodoCommits(repoPath, body.base)).map((c) => c.hash).sort();
  const given = body.entries.map((e) => e.hash).sort();
  if (actual.join('\n') !== given.join('\n')) {
    throw new ServiceError('INVALID_QUERY', '提交清单与仓库实际不符');
  }
  return runInteractiveRebase(repoPath, { base: body.base, entries: body.entries });
}
