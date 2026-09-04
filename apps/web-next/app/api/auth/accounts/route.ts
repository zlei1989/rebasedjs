/** /api/auth/accounts —— GET 账户列表（掩码视图）；POST zod 校验 → upsertAccount（添加/覆盖）→ 返回刷新掩码视图。应用级，无 repoId */
import { listAccounts, upsertAccount } from '@rebased/api';
import { accountBodySchema } from '@rebased/contracts';
import { handleApiError } from '../../../../src/server-context';

export async function GET(): Promise<Response> {
  try {
    return Response.json(listAccounts());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = accountBodySchema.parse(await req.json());
    return Response.json(upsertAccount(body));
  } catch (error) {
    return handleApiError(error);
  }
}
