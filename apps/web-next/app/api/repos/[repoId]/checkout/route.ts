/** POST /api/repos/:repoId/checkout —— zod 校验 action → applyCheckout（branch/newBranch/detach）→ 200 RepoStatus；错误映射 */
import { applyCheckout } from '@rebased/api';
import { checkoutActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = checkoutActionSchema.parse(await req.json());
    return Response.json(await applyCheckout(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
