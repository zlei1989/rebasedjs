/** 仓库状态功能：core 原语 → contracts 形状的薄映射。 */
import { getStatus } from '@rebased/core';
import type { RepoStatus } from '@rebased/contracts';

export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  const s = await getStatus(repoPath);
  return {
    branch: s.branch,
    upstream: s.upstream,
    headHash: s.headHash,
    ahead: s.ahead,
    behind: s.behind,
    entries: s.entries.map((e) => ({ path: e.path, code: e.code, renameFrom: e.renameFrom })),
  };
}
