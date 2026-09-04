/** POST /api/repos/:repoId/rebase —— zod 校验请求体 → rebaseBranch（onto 变基）→ 200 RebaseOutcome；无效 onto → 400 INVALID_REF */
import { rebaseBranch } from '@rebased/api';
import { rebaseBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = rebaseBodySchema.parse(await req.json());
    return Response.json(await rebaseBranch(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
