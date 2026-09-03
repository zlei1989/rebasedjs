/** 暂存区功能：文件级与 hunk 级暂存操作，core 原语 → contracts 形状，操作后返回刷新状态。 */
import { applyPatch, cleanUntracked, collectFileDiff, discardPaths, stagePaths, unstagePaths } from '@rebased/core';
import { ServiceError, type HunkStagingBody, type RepoStatus, type StagingBody } from '@rebased/contracts';
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

/**
 * 切分 unified diff 全文为"头部 + hunks 数组"（保持行尾 \n）：
 * 按行扫描——`diff --git` 起至首个 `@@` 前为头部；每个 `@@ ... @@` 行开启一个 hunk，
 * 行至下一 `@@` 或文件尾（末行 `\ No newline at end of file` 归属其上方 hunk）。
 */
function splitHunks(text: string): { header: string; hunks: string[] } {
  const lines = (text.match(/[^\n]*(?:\n|$)/g) ?? []).filter((l) => l !== '');
  let header = '';
  const hunks: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) hunks.push(line);
    else if (hunks.length === 0) header += line;
    else hunks[hunks.length - 1] += line;
  }
  return { header, hunks };
}

/** hunk 级暂存操作：collectFileDiff 取 file 的 unified 全文 → 切分为"头部 + hunks 数组" → 按 body.hunks 索引子集重组 patch → applyPatch 执行。
 *  映射规则：stage→对工作区 diff（staged:false）apply --cached；unstage→对暂存 diff（staged:true）apply --cached -R；discard→对工作区 diff apply -R（放弃工作区修改）。
 *  索引越界 → ServiceError('INVALID_QUERY', 'hunk 索引超出范围') */
export async function applyHunkStaging(repoPath: string, body: HunkStagingBody): Promise<RepoStatus> {
  const staged = body.action === 'unstage';
  const text = await collectFileDiff(repoPath, { file: body.file, staged });
  const { header, hunks } = splitHunks(text);
  for (const i of body.hunks) {
    if (i >= hunks.length) throw new ServiceError('INVALID_QUERY', 'hunk 索引超出范围');
  }
  // 重组 = 头部 + 选中 hunk 原文拼接；去重并按文件出现顺序排列（git apply 要求 hunk 有序）
  const selected = [...new Set(body.hunks)].sort((a, b) => a - b).map((i) => hunks[i]);
  const patch = header + selected.join('');
  await applyPatch(repoPath, patch, { cached: body.action !== 'discard', reverse: body.action !== 'stage' });
  return getRepoStatus(repoPath);
}
