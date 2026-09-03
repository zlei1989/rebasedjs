/** 冲突功能：core conflict 原语 → contracts 形状；解决操作写前校验路径在冲突列表中，操作后返回刷新列表。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkoutConflictSide, listConflictedPaths, markResolved, readStageContent } from '@rebased/core';
import { ServiceError, type ConflictContents, type ConflictList, type ResolveConflictBody } from '@rebased/contracts';

/** 冲突列表：core → 契约薄映射 */
export async function getConflicts(repoPath: string): Promise<ConflictList> {
  const conflicts = await listConflictedPaths(repoPath);
  return { conflicts: conflicts.map((c) => ({ path: c.path, stages: c.stages })) };
}

/** 三版本内容：stage 1/2/3 → base/ours/theirs 字段映射（某阶段不存在为 null） */
export async function getConflictContents(repoPath: string, path: string): Promise<ConflictContents> {
  const [base, ours, theirs] = await Promise.all([
    readStageContent(repoPath, path, 1),
    readStageContent(repoPath, path, 2),
    readStageContent(repoPath, path, 3),
  ]);
  return { path, base, ours, theirs };
}

/**
 * 按策略解决：ours/theirs → checkoutConflictSide + markResolved；manual → 写 content 到工作区文件后 markResolved。
 * 写前校验 path 在冲突列表中，不在 → INVALID_QUERY '该文件没有冲突：…'；返回刷新列表。
 */
export async function resolveConflict(repoPath: string, body: ResolveConflictBody): Promise<ConflictList> {
  const { conflicts } = await getConflicts(repoPath);
  if (!conflicts.some((c) => c.path === body.path)) {
    throw new ServiceError('INVALID_QUERY', `该文件没有冲突：${body.path}`);
  }
  if (body.strategy === 'manual') {
    await writeFile(join(repoPath, body.path), body.content);
  } else {
    await checkoutConflictSide(repoPath, body.path, body.strategy);
  }
  await markResolved(repoPath, body.path);
  return getConflicts(repoPath);
}
