/** POST /api/repos/:repoId/revert —— zod 校验请求体 → revert（逐哈希预检后生成 Revert 提交）→ 200 PickOutcome */
import { revert } from '@rebased/api';
import { pickBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = pickBodySchema.parse(await req.json());
    return Response.json(await revert(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
