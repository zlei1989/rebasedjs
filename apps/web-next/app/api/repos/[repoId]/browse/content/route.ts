/** GET /api/repos/:repoId/browse/content —— zod 校验查询 → getBrowseContent（指定版本单文件内容）→ 200 BrowseContent */
import { getBrowseContent } from '@rebased/api';
import { browseContentQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = browseContentQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const content = await getBrowseContent(resolveRepo(z.string().min(1).parse(repoId)), query);
    return Response.json(content);
  } catch (error) {
    return handleApiError(error);
  }
}
