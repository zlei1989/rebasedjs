/**
 * Update Project 功能：一次「更新项目」= fetch 全远程 + 按 strategy 的 pull。
 * fetch/pull 均经 remote.ts 的 withAuth 认证回路（token 注入 + AUTH_FAILED 识别）。
 */
import type { UpdateBody, UpdateOutcome } from '@rebased/contracts';
import { fetchRepo, pullRepo } from './remote';

/** Update Project：fetch 全远程 + 按 strategy 的 pull（merge=git pull / rebase=git pull --rebase） */
export async function updateProject(repoPath: string, body: UpdateBody): Promise<UpdateOutcome> {
  const { updatedRefs } = await fetchRepo(repoPath, {});
  const pull = await pullRepo(repoPath, { rebase: body.strategy === 'rebase' });
  return { fetched: updatedRefs, pull };
}
