/** POST /api/repos/:repoId/rebase/interactive —— zod 校验请求体 → runInteractiveRebaseService（清单全量校验后 sequence-editor 执行）→ 200 RebaseOutcome */
import { runInteractiveRebaseService } from '@rebased/api';
import { interactiveRebaseBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = interactiveRebaseBodySchema.parse(await req.json());
    return Response.json(await runInteractiveRebaseService(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
