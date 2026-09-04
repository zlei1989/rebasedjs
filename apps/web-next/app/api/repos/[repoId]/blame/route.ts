/** GET /api/repos/:repoId/blame —— zod 校验查询 → getFileBlame（单文件逐行溯源）→ 200 BlameLine[] */
import { getFileBlame } from '@rebased/api';
import { blameQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = blameQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const lines = await getFileBlame(resolveRepo(z.string().min(1).parse(repoId)), query.file);
    return Response.json(lines);
  } catch (error) {
    return handleApiError(error);
  }
}
