/** POST /api/repos/:repoId/commit/push —— commit & push 组合执行器（GitCommitAndPushExecutor 语义）→ 200 CommitAndPushOutcome；错误映射 */
import { commitAndPush } from '@rebased/api';
import { commitAndPushBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = commitAndPushBodySchema.parse(await req.json());
    return Response.json(await commitAndPush(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
