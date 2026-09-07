/** GET /api/repos/:repoId/diff/three-way —— zod 校验查询 → getFileThreeVersions（HEAD/暂存/工作区三侧全文）→ 200 FileThreeVersions */
import { getFileThreeVersions } from '@rebased/api';
import { threeWayQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = threeWayQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getFileThreeVersions(resolveRepo(z.string().min(1).parse(repoId)), query));
  } catch (error) {
    return handleApiError(error);
  }
}
