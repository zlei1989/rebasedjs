/** POST /api/repos/:repoId/patches/create —— zod 校验请求体 → createPatch（工作区/from/to/staged 数据源）→ 200 刷新 PatchList */
import { createPatch } from '@rebased/api';
import { patchCreateBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = patchCreateBodySchema.parse(await req.json());
    return Response.json(await createPatch(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
