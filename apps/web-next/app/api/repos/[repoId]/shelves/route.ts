/** GET /api/repos/:repoId/shelves —— 搁置列表（ShelfList）→ 错误映射；POST —— zod 校验 action → applyShelfAction → 返回刷新列表 */
import { applyShelfAction, getShelves } from '@rebased/api';
import { shelfActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getShelves(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = shelfActionSchema.parse(await req.json());
    return Response.json(await applyShelfAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
