/** 提交功能：提交暂存区内容，前置校验 git 身份配置；commit & push 组合执行器（GitCommitAndPushExecutor 语义）。 */
import { commitStaged, getGitConfigEntries, type CoreConfigEntry, pushBranch } from '@rebased/core';
import {
  ServiceError,
  type CommitAndPushBody,
  type CommitAndPushOutcome,
  type CommitBody,
} from '@rebased/contracts';
import { withAuth } from './remote';

/** 提交身份前置检查（纯函数，导出供单测覆盖缺失分支）：
 *  user.name/user.email 生效值任一缺失即抛 INVALID_QUERY——git 此时会退回自动探测身份，提交出的作者不可控。 */
export function assertCommitIdentity(entries: CoreConfigEntry[]): void {
  const byKey = new Map(entries.map((e) => [e.key, e.value]));
  if (!byKey.get('user.name') || !byKey.get('user.email')) {
    throw new ServiceError('INVALID_QUERY', '未配置 user.name 或 user.email，请先在设置页配置');
  }
}

/** 提交暂存区：前置检查 user.name/user.email 生效值；提交后返回新哈希 */
export async function createCommit(repoPath: string, body: CommitBody): Promise<{ hash: string }> {
  const entries = await getGitConfigEntries(repoPath, ['user.name', 'user.email']);
  assertCommitIdentity(entries);
  const hash = await commitStaged(repoPath, {
    message: body.message,
    amend: body.amend,
    signOff: body.signOff,
    noVerify: body.noVerify,
  });
  return { hash };
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
