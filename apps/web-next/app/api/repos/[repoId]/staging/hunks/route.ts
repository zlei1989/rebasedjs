/** POST /api/repos/:repoId/staging/hunks —— zod 校验请求体 → applyHunkStaging（hunk 级 stage/unstage/discard）→ 200 RepoStatus；错误映射 */
import { applyHunkStaging } from '@rebased/api';
import { hunkStagingBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = hunkStagingBodySchema.parse(await req.json());
    return Response.json(await applyHunkStaging(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
