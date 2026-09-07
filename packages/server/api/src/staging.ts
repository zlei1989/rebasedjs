/** 暂存区功能：文件级与 hunk 级暂存操作，core 原语 → contracts 形状，操作后返回刷新状态。 */
import { applyPatch, cleanUntracked, collectFileDiff, discardPaths, stagePaths, unstagePaths } from '@rebased/core';
import { ServiceError, splitPatchHunks, type HunkStagingBody, type RepoStatus, type StagingBody } from '@rebased/contracts';
import { getRepoStatus } from './status';

/** 文件级暂存操作：按 action 分派 core；discard 时先取 status，?? 条目走 cleanUntracked、其余走 discardPaths；返回刷新后的 RepoStatus */
export async function applyStaging(repoPath: string, body: StagingBody): Promise<RepoStatus> {
  switch (body.action) {
    case 'stage':
      await stagePaths(repoPath, body.paths);
      break;
    case 'unstage':
      await unstagePaths(repoPath, body.paths);
      break;
    case 'discard': {
      // restore 不能删未跟踪文件、clean 不能还原已跟踪修改，须按条目状态分流
      const status = await getRepoStatus(repoPath);
      const untracked = new Set(status.entries.filter((e) => e.code === '??').map((e) => e.path));
      const toClean = body.paths.filter((p) => untracked.has(p));
      const toRestore = body.paths.filter((p) => !untracked.has(p));
      if (toRestore.length > 0) await discardPaths(repoPath, toRestore);
      if (toClean.length > 0) await cleanUntracked(repoPath, toClean);
      break;
    }
  }
  return getRepoStatus(repoPath);
}

/** hunk 级暂存操作：collectFileDiff 取 file 的 unified 全文 → 契约层共享切片（与 ui 行内选择同源，索引编号一致）
 *  → 按 body.hunks 索引子集重组 patch → applyPatch 执行。
 *  映射规则：stage→对工作区 diff（staged:false）apply --cached；unstage→对暂存 diff（staged:true）apply --cached -R；discard→对工作区 diff apply -R（放弃工作区修改）。
 *  索引越界 → ServiceError('INVALID_QUERY', 'hunk 索引超出范围') */
export async function applyHunkStaging(repoPath: string, body: HunkStagingBody): Promise<RepoStatus> {
  const staged = body.action === 'unstage';
  const text = await collectFileDiff(repoPath, { file: body.file, staged });
  const { header, hunks } = splitPatchHunks(text);
  for (const i of body.hunks) {
    if (i >= hunks.length) throw new ServiceError('INVALID_QUERY', 'hunk 索引超出范围');
  }
  // 重组 = 头部 + 选中 hunk 原文拼接；去重并按文件出现顺序排列（git apply 要求 hunk 有序）
  const selected = [...new Set(body.hunks)].sort((a, b) => a - b).map((i) => hunks[i].text);
  const patch = header + selected.join('');
  await applyPatch(repoPath, patch, { cached: body.action !== 'discard', reverse: body.action !== 'stage' });
  return getRepoStatus(repoPath);
}
