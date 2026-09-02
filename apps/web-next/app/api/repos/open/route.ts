/** POST /api/repos/open —— zod 校验请求体 → openRepo（验证+注册）→ {repoId} */
import { openRepo } from '@rebased/api';
import { openRepoBodySchema } from '@rebased/contracts';
import { handleApiError } from '../../../../src/server-context';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = openRepoBodySchema.parse(await req.json());
    const repo = await openRepo(body.path);
    return Response.json({ repoId: repo.id });
  } catch (error) {
    return handleApiError(error);
  }
}
