/** POST /api/repos/clone —— zod 校验请求体 → cloneRepo（git clone + 注册）→ {repoId} */
import { cloneRepo } from '@rebased/api';
import { cloneRepoBodySchema } from '@rebased/contracts';
import { handleApiError } from '../../../../src/server-context';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = cloneRepoBodySchema.parse(await req.json());
    const repo = await cloneRepo(body.url, body.targetDir);
    return Response.json({ repoId: repo.id });
  } catch (error) {
    return handleApiError(error);
  }
}
