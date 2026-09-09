/** POST /api/repos/:repoId/update/force-pushed —— force-push 后修复（fetch → 本地重置到上游 → 本地独有提交重放）→ 200 ForcePushedUpdateOutcome */
import { forcePushedUpdate } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await forcePushedUpdate(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
