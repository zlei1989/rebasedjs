/** POST /api/repos/:repoId/checkout-update —— zod 校验请求体 → checkoutUpdate（检出本地分支后策略化更新：
 *  fetch 跟踪分支 + merge/--rebase，GitCheckoutWithUpdateAction 语义）→ 200 RebaseOutcome；
 *  无上游/当前分支 → 400 INVALID_QUERY；分支不存在 → 400 INVALID_REF */
import { checkoutUpdate } from '@rebased/api';
import { checkoutUpdateBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = checkoutUpdateBodySchema.parse(await req.json());
    return Response.json(await checkoutUpdate(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
