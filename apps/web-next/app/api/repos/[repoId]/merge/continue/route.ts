/** POST /api/repos/:repoId/merge/continue —— 继续合并（冲突全解后产合并提交）→ 200 RepoStatus；无进行中合并 → 400 INVALID_QUERY；无请求体 */
import { continueMergeOperation } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await continueMergeOperation(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
