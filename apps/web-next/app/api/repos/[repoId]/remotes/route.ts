/** GET /api/repos/:repoId/remotes —— 远程列表；POST —— zod 校验 action → applyRemoteAction（add/remove/setUrl）→ 返回刷新列表 */
import { applyRemoteAction, getRemotes } from '@rebased/api';
import { remoteActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getRemotes(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = remoteActionSchema.parse(await req.json());
    return Response.json(await applyRemoteAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
