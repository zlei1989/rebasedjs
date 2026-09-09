/** POST /api/repos/:repoId/checkout-rebase —— zod 校验请求体 → checkoutRebase（检出目标分支后变基到当前分支，
 *  远程分支带新本地名 localName）→ 200 RebaseOutcome；分支不存在 → 400 INVALID_REF；目标为当前分支 → 400 INVALID_QUERY */
import { checkoutRebase } from '@rebased/api';
import { checkoutRebaseBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = checkoutRebaseBodySchema.parse(await req.json());
    return Response.json(await checkoutRebase(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
