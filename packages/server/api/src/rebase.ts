/**
 * 变基功能：onto 变基、todo 数据源、交互式变基（清单全量校验）、auto-squash（fixup!/squash! 折入）。
 * 发起类操作预检无进行中操作（避免 core 把既有操作态误判为冲突结果）；
 * 交互式 todo 的 entries 与仓库实际 base..HEAD 提交做全量哈希比对——防错基/漏改的静默脏数据。
 */
import {
  autosquashCommit,
  checkoutWithRebase,
  editCommitAction,
  GitExitError,
  headCommit,
  isAncestorCommit,
  listBranches,
  listTodoCommits,
  rebaseOnto,
  runInteractiveRebase,
  verifyCommitish,
} from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { AutosquashBody, CheckoutRebaseBody, CommitEditBody, InteractiveRebaseBody, RebaseBody, RebaseOutcome, TodoEntry } from '@rebased/contracts';
import { assertNoOperationInProgress } from './operation';

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

/**
 * auto-squash（GitCommitFixupBySubjectAction / GitCommitSquashBySubjectAction 语义）：
 * 预检无进行中操作 + 目标有效性（verifyCommitish → INVALID_REF）+ 目标为 HEAD 祖先（INVALID_QUERY）；
 * core 以 `fixup!/squash! <subject>` 提交 + `rebase -i --autosquash` 折入目标；无暂存内容 → INVALID_QUERY
 * （对齐 Java GitEmptyCommitProblemDetector 的「nothing to commit」提示，不当 500 抛）；冲突透出 conflicts。
 */
export async function applyAutosquash(repoPath: string, body: AutosquashBody): Promise<RebaseOutcome> {
  await assertNoOperationInProgress(repoPath);
  if (!(await verifyCommitish(repoPath, body.hash))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${body.hash}`);
  }
  if (!(await isAncestorOfHead(repoPath, body.hash))) {
    throw new ServiceError('INVALID_QUERY', '目标提交不在当前分支历史中');
  }
  try {
    return await autosquashCommit(repoPath, body);
  } catch (e) {
    // 无暂存内容：git commit 的 "nothing to commit"（写 stdout）→ 业务引导（Java 同文案链路，不当 500）
    if (e instanceof GitExitError && /nothing to commit/i.test(`${e.stdout}${e.stderr}`)) {
      throw new ServiceError('INVALID_QUERY', '没有暂存的变更，请先在状态页暂存要折入的内容');
    }
    throw e;
  }
}

/** 祖先判定（目标须在当前分支 HEAD 历史中；git merge-base --is-ancestor） */
async function isAncestorOfHead(repoPath: string, hash: string): Promise<boolean> {
  const head = await headCommit(repoPath);
  if (head === null) return false;
  return isAncestorCommit(repoPath, hash, head);
}

/**
 * 单提交编辑直通（GitSingleCommitEditingAction 语义：Reword/Drop/Squash/Fixup）：
 * 预检无进行中操作 + 哈希有效性（INVALID_REF）+ 祖先（INVALID_QUERY）+ reword 必带 message（INVALID_QUERY）
 * + squash/fixup 目标有父提交（INVALID_QUERY，根提交无父不可并入）+ hash 非 HEAD（历史重写绕过当前分支语义，
 * 对齐 Java 编辑动作在当前分支上执行——HEAD 编辑交给 interactive rebase 全量入口）。
 */
export async function commitEdit(repoPath: string, body: CommitEditBody): Promise<RebaseOutcome> {
  await assertNoOperationInProgress(repoPath);
  if (!(await verifyCommitish(repoPath, body.hash))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${body.hash}`);
  }
  if (!(await isAncestorOfHead(repoPath, body.hash))) {
    throw new ServiceError('INVALID_QUERY', '目标提交不在当前分支历史中');
  }
  if (body.action === 'reword' && (body.message === undefined || body.message.trim() === '')) {
    throw new ServiceError('INVALID_QUERY', 'reword 需要新提交信息');
  }
  if (body.action === 'squash' || body.action === 'fixup') {
    // 父提交有效性：根提交（无父）→ INVALID_QUERY（哈希为 HEAD 祖先时父亦在历史内，无需再查祖先）
    if (!(await verifyCommitish(repoPath, `${body.hash}^`))) {
      throw new ServiceError('INVALID_QUERY', 'squash/fixup 目标须有父提交（当前分支历史内）');
    }
  }
  return editCommitAction(repoPath, body);
}

/**
 * 检出并变基（GitCheckoutWithRebaseAction 语义）：预检无进行中操作 + 分支存在（本地名精确 / remotes/ 前缀远程名，INVALID_REF）
 * + 目标 ≠ 当前分支（INVALID_QUERY，分离头同样拒绝——变基需在当前分支上执行）+ 远程分支的本地名冲突分流：
 * 本地已有同名分支且跟踪同一远程 → 检出既有分支再变基（Java reset=false 语义，新建跳过）；跟踪不同/无跟踪 → INVALID_QUERY
 * （对齐 Java 的 tracking conflict 重命名提示）。核心执行：检出（远程 → 新建本地分支）→ rebase onto 原当前分支。
 */
export async function checkoutRebase(repoPath: string, body: CheckoutRebaseBody): Promise<RebaseOutcome> {
  await assertNoOperationInProgress(repoPath);
  const branches = await listBranches(repoPath);
  const target = branches.find((b) => b.name === body.branch);
  if (target === undefined) {
    throw new ServiceError('INVALID_REF', `分支不存在：${body.branch}`);
  }
  const current = branches.find((b) => b.current);
  if (current === undefined) {
    throw new ServiceError('INVALID_QUERY', '分离头指针状态不可检出并变基（请先检出分支）');
  }
  if (!target.remote) {
    if (current.name === target.name) {
      throw new ServiceError('INVALID_QUERY', '不能检出并变基当前分支（可先检其他分支）');
    }
    const result = await checkoutWithRebase(repoPath, { branch: target.name, isRemote: false });
    return { status: result.status };
  }
  // 远程分支：新本地名缺省剥远程名前缀（origin/main → main）；与本地已有分支同名时按跟踪关系分流
  const localName = body.localName ?? target.name.replace(/^[^/]+\//, '');
  const existingLocal = branches.find((b) => !b.remote && b.name === localName);
  if (existingLocal !== undefined) {
    if (existingLocal.current) {
      throw new ServiceError('INVALID_QUERY', `本地当前分支与新建名相同（${localName}），请选择其他本地分支名`);
    }
    if (existingLocal.upstream !== target.name) {
      throw new ServiceError('INVALID_QUERY', `本地已存在同名分支 ${localName} 且未跟踪 ${target.name}，请选择其他本地分支名`);
    }
    const result = await checkoutWithRebase(repoPath, { branch: existingLocal.name, isRemote: false });
    return { status: result.status };
  }
  const result = await checkoutWithRebase(repoPath, { branch: target.name, isRemote: true, localName });
  return { status: result.status };
}
