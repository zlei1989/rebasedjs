/** GET /api/repos/:repoId/gitlab/mrs —— zod 校验查询（state 缺省 opened）→ getGitlabMrs → 200 GitLabMrList；state 非法 → 400 */
import { createGitlabMr, getGitlabMrs } from '@rebased/api';
import { gitlabMrCreateBodySchema, gitlabMrQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = gitlabMrQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getGitlabMrs(resolveRepo(z.string().min(1).parse(repoId)), query.state));
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST /api/repos/:repoId/gitlab/mrs —— zod 校验请求体 → createGitlabMr → 200 重查 GitLabMrDetail；body 缺字段 → 400 */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = gitlabMrCreateBodySchema.parse(await req.json());
    return Response.json(await createGitlabMr(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
