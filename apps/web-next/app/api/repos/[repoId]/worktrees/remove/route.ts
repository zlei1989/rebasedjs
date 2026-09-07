/** POST /api/repos/:repoId/worktrees/remove —— zod 校验请求体 → removeWorktree → 200 刷新 WorktreeList；path 空/不在列表 → 400 */
import { removeWorktree } from '@rebased/api';
import { worktreeRemoveBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = worktreeRemoveBodySchema.parse(await req.json());
    return Response.json(await removeWorktree(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
