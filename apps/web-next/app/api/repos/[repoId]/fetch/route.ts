/** POST /api/repos/:repoId/fetch —— zod 校验请求体（可空 {}）→ fetchRepo → 200 FetchResult；认证失败 → 401 AUTH_FAILED（context.host 供对话框预填） */
import { fetchRepo } from '@rebased/api';
import { fetchBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = fetchBodySchema.parse(await req.json());
    return Response.json(await fetchRepo(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
