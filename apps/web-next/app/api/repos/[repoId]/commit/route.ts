/** POST /api/repos/:repoId/commit —— zod 校验请求体 → createCommit（缺 user.name/email → 400 INVALID_QUERY）→ 200 {hash}；错误映射 */
import { createCommit } from '@rebased/api';
import { commitBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = commitBodySchema.parse(await req.json());
    return Response.json(await createCommit(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
