/** GET /api/repos/:repoId/search —— zod 校验查询 → searchCommitsService（grep/pickaxe）→ 200 SearchResult[] */
import { searchCommitsService } from '@rebased/api';
import { searchQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = searchQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const results = await searchCommitsService(resolveRepo(z.string().min(1).parse(repoId)), query);
    return Response.json(results);
  } catch (error) {
    return handleApiError(error);
  }
}
