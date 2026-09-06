/** GET /api/repos/:repoId/console —— zod 校验查询（limit 默认 100，coerce 数字）→ getConsole → 200 ConsoleEntry[]（旧→新，id 从 1 递增） */
import { getConsole } from '@rebased/api';
import { consoleQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = consoleQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getConsole(resolveRepo(z.string().min(1).parse(repoId)), query.limit));
  } catch (error) {
    return handleApiError(error);
  }
}
