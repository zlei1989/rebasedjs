/** GET/POST /api/repos/:repoId/worktrees —— 列表 / 创建（zod 校验请求体）：均 200 刷新 WorktreeList；互斥/分支不存在/路径无效 → 400 */
import { createWorktree, getWorktrees } from '@rebased/api';
import { worktreeCreateBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getWorktrees(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = worktreeCreateBodySchema.parse(await req.json());
    return Response.json(await createWorktree(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
