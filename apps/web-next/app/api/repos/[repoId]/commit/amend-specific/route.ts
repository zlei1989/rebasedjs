/** POST /api/repos/:repoId/commit/amend-specific —— amend 指定历史提交（amend! 提交 + fixup -C 折入目标）→ 200 {status,hash?}；目标无效 → 400 INVALID_REF/INVALID_QUERY */
import { amendSpecificCommit } from '@rebased/api';
import { amendSpecificBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = amendSpecificBodySchema.parse(await req.json());
    return Response.json(await amendSpecificCommit(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
