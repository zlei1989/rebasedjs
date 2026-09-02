/** GET /api/repos/:repoId/diff —— zod 校验查询 → getFileVersions（UX 对齐 Monaco 需要两侧全文）→ 错误映射 */
import { getFileVersions } from '@rebased/api';
import { diffQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = diffQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const versions = await getFileVersions(resolveRepo(z.string().min(1).parse(repoId)), query);
    return Response.json(versions);
  } catch (error) {
    return handleApiError(error);
  }
}
