/** GET /api/repos/:repoId/submodules —— submodule 列表 → 200 SubmoduleList；损坏 .gitmodules → 500 GIT_ERROR */
import { getSubmodules } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getSubmodules(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
