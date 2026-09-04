/** POST /api/auth/accounts/delete —— zod 校验 → deleteAccount → 返回刷新掩码视图；账户不存在 → 400 INVALID_QUERY。应用级，无 repoId */
import { deleteAccount } from '@rebased/api';
import { accountDeleteBodySchema } from '@rebased/contracts';
import { handleApiError } from '../../../../../src/server-context';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = accountDeleteBodySchema.parse(await req.json());
    return Response.json(deleteAccount(body));
  } catch (error) {
    return handleApiError(error);
  }
}
