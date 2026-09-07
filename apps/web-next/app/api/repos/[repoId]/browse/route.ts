/** GET /api/repos/:repoId/browse —— zod 校验查询 → getBrowseTree（指定版本文件树）→ 200 BrowseTree */
import { getBrowseTree } from '@rebased/api';
import { browseQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = browseQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const tree = await getBrowseTree(resolveRepo(z.string().min(1).parse(repoId)), query.rev);
    return Response.json(tree);
  } catch (error) {
    return handleApiError(error);
  }
}
