/** POST /api/repos/:repoId/patches/delete —— zod 校验请求体 → deletePatch → 200 刷新 PatchList；补丁不存在 → 400 INVALID_REF */
import { deletePatch } from '@rebased/api';
import { patchDeleteBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = patchDeleteBodySchema.parse(await req.json());
    return Response.json(await deletePatch(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
