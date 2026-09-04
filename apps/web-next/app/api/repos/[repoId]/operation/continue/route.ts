/** POST /api/repos/:repoId/operation/continue —— 继续进行中操作（按 kind 分派 merge/rebase/cherry-pick/revert；无请求体）→ 200 RepoStatus；无态 → 400 INVALID_QUERY */
import { continueOperation } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await continueOperation(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
