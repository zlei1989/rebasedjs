/** GET /api/repos/:repoId/ignore —— 忽略配置读（.gitignore 与 .git/info/exclude）→ 错误映射；PUT —— zod 校验 → putIgnore → 返回刷新视图 */
import { getIgnore, putIgnore } from '@rebased/api';
import { ignorePutBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getIgnore(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = ignorePutBodySchema.parse(await req.json());
    return Response.json(await putIgnore(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
