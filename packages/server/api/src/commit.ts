/**
 * 提交功能：提交暂存区内容，前置校验 git 身份配置；commit & push 组合执行器（GitCommitAndPushExecutor 语义）；
 * amend 指定历史提交（GitCommitDialog「Amend <subject>」下拉语义）——amend! 提交 + fixup -C 交互式变基折入目标。
 */
import {
  amendSpecificCommit as coreAmendSpecificCommit,
  commitStaged,
  detectCrlfWarning,
  getGitConfigEntries,
  headCommit,
  isAncestorCommit,
  listAmendTargets,
  setGlobalAutocrlf,
  verifyCommitish,
  type CoreConfigEntry,
  pushBranch,
} from '@rebased/core';
import {
  ServiceError,
  type AmendSpecificBody,
  type AmendTarget,
  type CommitAndPushBody,
  type CommitAndPushOutcome,
  type CommitBody,
  type CrlfWarning,
} from '@rebased/contracts';
import { assertNoOperationInProgress } from './operation';
import { withAuth } from './remote';

/** 提交身份前置检查（纯函数，导出供单测覆盖缺失分支）：
 *  user.name/user.email 生效值任一缺失即抛 INVALID_QUERY——git 此时会退回自动探测身份，提交出的作者不可控。 */
export function assertCommitIdentity(entries: CoreConfigEntry[]): void {
  const byKey = new Map(entries.map((e) => [e.key, e.value]));
  if (!byKey.get('user.name') || !byKey.get('user.email')) {
    throw new ServiceError('INVALID_QUERY', '未配置 user.name 或 user.email，请先在设置页配置');
  }
}

/** 提交暂存区：前置检查 user.name/user.email 生效值；提交后返回新哈希。
 *  crlfFix = GitCrlfDialog「修复并提交」：先写 core.autocrlf 建议值（--global）再提交 */
export async function createCommit(repoPath: string, body: CommitBody): Promise<{ hash: string }> {
  const entries = await getGitConfigEntries(repoPath, ['user.name', 'user.email']);
  assertCommitIdentity(entries);
  if (body.crlfFix === true) {
    await setGlobalAutocrlf(repoPath);
  }
  const hash = await commitStaged(repoPath, {
    message: body.message,
    amend: body.amend,
    signOff: body.signOff,
    noVerify: body.noVerify,
  });
  return { hash };
}

/** CRLF 提示（GitCrlfDialog 语义）：检测即将提交的暂存文件是否含无属性覆盖的 CRLF（Windows + autocrlf 未建议配置） */
export async function getCrlfWarning(repoPath: string): Promise<CrlfWarning> {
  return detectCrlfWarning(repoPath);
}

/**
 * amend 目标候选（GitAmendCommitService 语义）：未发布的非合并非 HEAD 提交，旧→新，上限 20。
 * 供提交框「Amend <subject>」下拉（列表为空 → 无特定目标，仅常规 amend）。
 */
export async function getAmendTargets(repoPath: string): Promise<AmendTarget[]> {
  return listAmendTargets(repoPath);
}

/**
 * amend 指定历史提交：预检无进行中操作 + 目标有效性（verifyCommitish → INVALID_REF）+
 * 目标 ≠ HEAD（INVALID_QUERY）+ 目标为 HEAD 祖先（INVALID_QUERY）+ 身份配置；
 * core 以 amend! 提交 + fixup -C 交互式变基折入目标（冲突 → 冲突态交冲突页）。
 */
export async function amendSpecificCommit(
  repoPath: string,
  body: AmendSpecificBody,
): Promise<{ status: 'success' | 'conflicts'; hash?: string }> {
  await assertNoOperationInProgress(repoPath);
  if (!(await verifyCommitish(repoPath, body.targetHash))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${body.targetHash}`);
  }
  const head = await headCommit(repoPath);
  if (head === body.targetHash) {
    throw new ServiceError('INVALID_QUERY', '目标不能是当前 HEAD（改上次提交请勾选 amend）');
  }
  if (head === null || !(await isAncestorCommit(repoPath, body.targetHash, head))) {
    throw new ServiceError('INVALID_QUERY', '目标提交不在当前分支历史中');
  }
  const entries = await getGitConfigEntries(repoPath, ['user.name', 'user.email']);
  assertCommitIdentity(entries);
  return coreAmendSpecificCommit(repoPath, body);
}

/**
 * commit & push 组合执行器：先提交（身份预检、zod 已校验）再推送。
 * 非原子（与 Java GitCommitAndPushExecutor 一致——提交先落盘，推送失败如实上报，
 * 调用方以 push.status 分派提示）；push 缺省载荷 = 当前分支上游（GitCommitAndPushAction 语义）。
 */
export async function commitAndPush(repoPath: string, body: CommitAndPushBody): Promise<CommitAndPushOutcome> {
  const commit = await createCommit(repoPath, body);
  const push = await withAuth(repoPath, body.push?.remote, (extraConfig) =>
    pushBranch(repoPath, {
      remote: body.push?.remote,
      branch: body.push?.branch,
      forceWithLease: body.push?.forceWithLease,
      setUpstream: body.push?.setUpstream,
      extraConfig,
    }),
  );
  return { commit, push };
}
