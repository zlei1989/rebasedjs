/** POST /api/repos/:repoId/reset —— zod 校验请求体 → applyReset（soft/mixed/hard 重置到 ref）→ 200 RepoStatus；无效 ref → 400 INVALID_REF */
import { applyReset } from '@rebased/api';
import { resetBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = resetBodySchema.parse(await req.json());
    return Response.json(await applyReset(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
