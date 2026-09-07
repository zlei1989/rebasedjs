/** POST /api/repos/:repoId/worktrees/prune —— 无请求体 → pruneWorktrees → 200 刷新 WorktreeList */
import { pruneWorktrees } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await pruneWorktrees(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
