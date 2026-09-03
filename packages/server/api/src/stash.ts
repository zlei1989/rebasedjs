/** 贮藏功能：core 贮藏原语 → contracts 形状；写操作前预检（save 取 status、其余校验 index），操作后返回刷新列表。 */
import {
  applyStash,
  dropStash,
  listStashes,
  popStash,
  saveStash,
  stashToBranch,
} from '@rebased/core';
import { ServiceError, type StashAction, type StashList } from '@rebased/contracts';
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

/** 贮藏写操作分派：save 前预检工作区改动；apply/pop/drop/branch 前校验 index；返回刷新列表 */
export async function applyStashAction(repoPath: string, action: StashAction): Promise<StashList> {
  switch (action.action) {
    case 'save':
      await requireStashableChanges(repoPath, action.includeUntracked ?? false);
      await saveStash(repoPath, { message: action.message, includeUntracked: action.includeUntracked });
      break;
    case 'apply':
      await requireStashIndex(repoPath, action.index);
      await applyStash(repoPath, action.index);
      break;
    case 'pop':
      await requireStashIndex(repoPath, action.index);
      await popStash(repoPath, action.index);
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
