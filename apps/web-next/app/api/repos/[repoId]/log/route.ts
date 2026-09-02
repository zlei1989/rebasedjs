/** GET /api/repos/:repoId/log —— zod 校验查询 → 调 api → 错误映射 */
import { getLogPage } from '@rebased/api';
import { logQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = logQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const page = await getLogPage(resolveRepo(z.string().min(1).parse(repoId)), query);
    return Response.json(page);
  } catch (error) {
    return handleApiError(error);
  }
}
