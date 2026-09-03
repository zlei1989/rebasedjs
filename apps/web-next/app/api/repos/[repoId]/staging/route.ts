/** POST /api/repos/:repoId/staging —— zod 校验请求体 → applyStaging（文件级 stage/unstage/discard）→ 200 RepoStatus；错误映射 */
import { applyStaging } from '@rebased/api';
import { stagingBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = stagingBodySchema.parse(await req.json());
    return Response.json(await applyStaging(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
