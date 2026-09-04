/** GET /api/repos/:repoId/committed —— zod 校验查询 → getCommittedPage（limit/skip 分页）→ 200 CommittedPage */
import { getCommittedPage } from '@rebased/api';
import { committedQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = committedQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const page = await getCommittedPage(resolveRepo(z.string().min(1).parse(repoId)), query);
    return Response.json(page);
  } catch (error) {
    return handleApiError(error);
  }
}
