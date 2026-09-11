/** 贮藏功能：core 贮藏原语 → contracts 形状；写操作前预检（save 取 status、其余校验 index），操作后返回刷新列表。 */
import {
  GitExitError,
  applyStash,
  checkoutBranch,
  dropStash,
  listConflictedPaths,
  listStashes,
  popStash,
  saveStash,
  stashPatch,
  stashToBranch,
} from '@rebased/core';
import { ServiceError, type StashAction, type StashDiff, type StashList, type StashUnstashAsBody } from '@rebased/contracts';
import { getRepoStatus } from './status';

/** 贮藏列表：core → 契约薄映射（CoreStash 与 StashEntry 形状一致，直传） */
export async function getStashes(repoPath: string): Promise<StashList> {
  return { stashes: await listStashes(repoPath) };
}

/**
 * save 预检：无工作区改动 → INVALID_QUERY。
 * entries 为空，或仅剩 ?? 未跟踪条目且未 includeUntracked（git stash push 不带 -u 时忽略未跟踪文件，必然空贮藏）。
 * 本地单用户场景下预检与执行间的竞态窗口可忽略，不做 stdout 兜底。
 */
async function requireStashableChanges(repoPath: string, includeUntracked: boolean): Promise<void> {
  const status = await getRepoStatus(repoPath);
  const hasStashable = status.entries.some((e) => includeUntracked || e.code !== '??');
  if (!hasStashable) {
    throw new ServiceError('INVALID_QUERY', '没有可贮藏的工作区改动');
  }
}

/** index 范围校验（apply/pop/drop/branch 的前置）：越界 → INVALID_REF */
async function requireStashIndex(repoPath: string, index: number): Promise<void> {
  const stashes = await listStashes(repoPath);
  if (index >= stashes.length) {
    throw new ServiceError('INVALID_REF', `贮藏不存在：stash@{${index}}`);
  }
}

/**
 * 贮藏应用类操作（apply / pop / unstashAs）的失败收口：
 * 两类失败此前都以裸 GitExitError 透出，UI 只见「退出码 1」而无原因（冒烟 D-24）：
 *  1) 冲突：`git stash apply` 在目标文件已被改动时写入冲突标记并非 0 退出
 *     （git 把 `path: needs merge` 打到 stdout），工作区已变脏，用户无从下手；
 *  2) 未跟踪文件占用：`git stash pop` 恢复 -u 贮藏的未跟踪文件时若同名文件已存在，
 *     git 报 `xxx already exists, no checkout`——需明确告知原因与处置（先移走/提交该文件）。
 * 冲突 → CONFLICT(409) + 冲突页指引；其余失败把 git 的首行可读原因并入提示。
 */
async function runStashRestoreGuarded(repoPath: string, run: () => Promise<void>, verb: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    const conflicts = await listConflictedPaths(repoPath);
    if (conflicts.length > 0) {
      const head = conflicts.slice(0, 3).map((c) => c.path).join('、');
      // 用 CONFLICT(409) 而非 GIT_ERROR(500)：语义正确（可恢复的用户态，非服务端故障），
      // 且避免走「未预期异常 → 500 → Next dev 错误覆盖层渲染中文源码行」的脆弱路径
      throw new ServiceError(
        'CONFLICT',
        `应用贮藏存在冲突（${conflicts.length} 个文件：${head}${conflicts.length > 3 ? ' 等' : ''}），请到冲突页解决后完成`,
      );
    }
    const detail = err instanceof GitExitError
      ? `${err.stdout}\n${err.stderr}`.split('\n').map((l) => l.trim()).find((l) => l !== '')
      : undefined;
    throw new ServiceError('GIT_ERROR', `${verb}失败${detail === undefined ? '' : `：${detail}`}`);
  }
}

/** 贮藏写操作分派：save 前预检工作区改动；apply/pop/drop/branch 前校验 index；返回刷新列表 */
export async function applyStashAction(repoPath: string, action: StashAction): Promise<StashList> {
  switch (action.action) {
    case 'save':
      await requireStashableChanges(repoPath, action.includeUntracked ?? false);
      await saveStash(repoPath, { message: action.message, includeUntracked: action.includeUntracked, keepIndex: action.keepIndex });
      break;
    case 'apply':
      await requireStashIndex(repoPath, action.index);
      await runStashRestoreGuarded(repoPath, () => applyStash(repoPath, action.index), '应用贮藏');
      break;
    case 'pop':
      await requireStashIndex(repoPath, action.index);
      await runStashRestoreGuarded(repoPath, () => popStash(repoPath, action.index), '弹出贮藏');
      break;
    case 'drop':
      await requireStashIndex(repoPath, action.index);
      await dropStash(repoPath, action.index);
      break;
    case 'branch':
      await requireStashIndex(repoPath, action.index);
      await stashToBranch(repoPath, action.index, action.name);
      break;
  }
  return getStashes(repoPath);
}

/** Unstash As：应用（不 drop）到已有分支——先检出目标分支再 apply（GitUnstashAsDialog 语义）；返回刷新后的贮藏列表 */
export async function unstashAs(repoPath: string, body: StashUnstashAsBody): Promise<StashList> {
  await requireStashIndex(repoPath, body.index);
  await checkoutBranch(repoPath, body.branch);
  await runStashRestoreGuarded(repoPath, () => applyStash(repoPath, body.index), '应用贮藏');
  return getStashes(repoPath);
}

/** 贮藏差异：index 校验后取 unified 补丁全文（git stash show -p） */
export async function getStashDiff(repoPath: string, index: number): Promise<StashDiff> {
  await requireStashIndex(repoPath, index);
  return { index, patch: await stashPatch(repoPath, index) };
}
