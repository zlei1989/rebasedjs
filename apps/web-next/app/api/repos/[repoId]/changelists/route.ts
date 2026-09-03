/** GET /api/repos/:repoId/changelists —— 变更列表视图；POST —— zod 校验 action → applyChangelistAction → 返回刷新视图 */
import { applyChangelistAction, getChangelists } from '@rebased/api';
import { changelistActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getChangelists(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = changelistActionSchema.parse(await req.json());
    return Response.json(await applyChangelistAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
