/**
 * POST /api/repos/:repoId/push —— zod 校验请求体 → pushRepo → 200 PushOutcome。
 * rejected（non-fast-forward）是 200 业务结果（附中文 hint），路由层无 409 特判；认证失败 → 401 AUTH_FAILED。
 */
import { pushRepo } from '@rebased/api';
import { pushBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = pushBodySchema.parse(await req.json());
    return Response.json(await pushRepo(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
