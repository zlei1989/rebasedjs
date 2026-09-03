/** POST /api/repos/:repoId/reset/undo-commit —— 撤销最近提交（soft 到 HEAD~1）→ 200 RepoStatus；根提交/无提交 → 400 INVALID_QUERY；无请求体 */
import { undoCommit } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await undoCommit(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
