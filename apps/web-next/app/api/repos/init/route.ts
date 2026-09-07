/** POST /api/repos/init —— zod 校验请求体 → initRepo（git init + 注册）→ {repoId} */
import { initRepo } from '@rebased/api';
import { initRepoBodySchema } from '@rebased/contracts';
import { handleApiError } from '../../../../src/server-context';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = initRepoBodySchema.parse(await req.json());
    const repo = await initRepo(body.path);
    return Response.json({ repoId: repo.id });
  } catch (error) {
    return handleApiError(error);
  }
}
