/** POST /api/repos/:repoId/commit-edit —— 单提交编辑直通（reword/drop/squash/fixup：GitSingleCommitEditingAction 语义）→ 200 RebaseOutcome */
import { commitEdit } from '@rebased/api';
import { commitEditBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = commitEditBodySchema.parse(await req.json());
    return Response.json(await commitEdit(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
