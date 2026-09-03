/** GET /api/repos/:repoId/diff/patch —— zod 校验查询 → getFileDiff（unified patch 全文，供 hunk 级暂存索引）→ 错误映射 */
import { getFileDiff } from '@rebased/api';
import { diffQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = diffQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const diff = await getFileDiff(resolveRepo(z.string().min(1).parse(repoId)), query);
    return Response.json(diff);
  } catch (error) {
    return handleApiError(error);
  }
}
