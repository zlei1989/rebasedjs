/** POST /api/repos/:repoId/submodules/update —— zod 校验请求体 → updateSubmodules → 200 刷新 SubmoduleList；name 空 → 400 */
import { updateSubmodules } from '@rebased/api';
import { submoduleUpdateBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = submoduleUpdateBodySchema.parse(await req.json());
    return Response.json(await updateSubmodules(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
