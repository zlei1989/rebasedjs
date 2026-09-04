/** GET /api/repos/:repoId/rebase/todo —— zod 校验查询（base）→ getRebaseTodo（base..HEAD 全量，反序）→ 200 TodoEntry[] */
import { getRebaseTodo } from '@rebased/api';
import { rebaseTodoQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = rebaseTodoQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getRebaseTodo(resolveRepo(z.string().min(1).parse(repoId)), query.base));
  } catch (error) {
    return handleApiError(error);
  }
}
