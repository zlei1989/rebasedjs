/** GET /api/repos/:repoId/commit/amend-targets —— amend 目标候选（GitCommitDialog「Amend <subject>」下拉）→ 200 AmendTarget[] */
import { getAmendTargets } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getAmendTargets(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
