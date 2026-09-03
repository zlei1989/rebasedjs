/** GET /api/repos/:repoId/stashes —— 贮藏列表；POST —— zod 校验 action → applyStashAction → 返回刷新列表 */
import { applyStashAction, getStashes } from '@rebased/api';
import { stashActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getStashes(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = stashActionSchema.parse(await req.json());
    return Response.json(await applyStashAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
