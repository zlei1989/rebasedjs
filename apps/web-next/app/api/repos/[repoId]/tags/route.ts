/** GET /api/repos/:repoId/tags —— 标签列表 → 200 TagList；POST —— zod 校验 action → applyTagAction（create/delete/push）→ 200 刷新 TagList */
import { applyTagAction, getTags } from '@rebased/api';
import { tagActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getTags(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = tagActionSchema.parse(await req.json());
    return Response.json(await applyTagAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
