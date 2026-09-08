/** POST /api/repos/:repoId/operation/skip —— 跳过冲突中的操作（rebase --skip / cherry-pick|revert --skip；无请求体）→ 200 RepoStatus；无态/merge → 400 INVALID_QUERY */
import { skipOperation } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await skipOperation(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
