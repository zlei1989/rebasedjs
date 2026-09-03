/** POST /api/repos/:repoId/merge —— zod 校验请求体 → mergeBranchIntoCurrent（分支并入当前）→ 200 MergeOutcome；分支不存在 → 400 GIT_ERROR */
import { mergeBranchIntoCurrent } from '@rebased/api';
import { mergeBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = mergeBodySchema.parse(await req.json());
    return Response.json(await mergeBranchIntoCurrent(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
