/** POST /api/repos/:repoId/update —— zod 校验请求体（strategy: merge|rebase）→ updateProject（fetch 全远程 + 策略化 pull）→ 200 UpdateOutcome */
import { updateProject } from '@rebased/api';
import { updateBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = updateBodySchema.parse(await req.json());
    return Response.json(await updateProject(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
