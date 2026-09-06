/** POST /api/repos/:repoId/patches/apply —— zod 校验请求体 → applyPatchService（check+apply 两段）→ 200 RepoStatus；补丁不存在 → 400 INVALID_REF，失败映射 INVALID_QUERY */
import { applyPatchService } from '@rebased/api';
import { patchApplyBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = patchApplyBodySchema.parse(await req.json());
    return Response.json(await applyPatchService(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
