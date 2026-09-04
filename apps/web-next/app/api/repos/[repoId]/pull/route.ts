/** POST /api/repos/:repoId/pull —— zod 校验请求体 → pullRepo（remote?/rebase?）→ 200 PullOutcome；认证失败 → 401 AUTH_FAILED */
import { pullRepo } from '@rebased/api';
import { pullBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = pullBodySchema.parse(await req.json());
    return Response.json(await pullRepo(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
