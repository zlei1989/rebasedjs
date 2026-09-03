/** GET /api/repos/:repoId/conflicts/contents —— zod 校验查询 → getConflictContents（base/ours/theirs 三版本全文）→ 200 ConflictContents */
import { getConflictContents } from '@rebased/api';
import { conflictContentsQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = conflictContentsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getConflictContents(resolveRepo(z.string().min(1).parse(repoId)), query.path));
  } catch (error) {
    return handleApiError(error);
  }
}
