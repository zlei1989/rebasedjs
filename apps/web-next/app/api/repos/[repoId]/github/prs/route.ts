/** GET /api/repos/:repoId/github/prs —— zod 校验查询（state 缺省 open）→ getGithubPrs → 200 GitHubPrList；state 非法 → 400 */
import { getGithubPrs } from '@rebased/api';
import { githubPrQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = githubPrQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getGithubPrs(resolveRepo(z.string().min(1).parse(repoId)), query.state));
  } catch (error) {
    return handleApiError(error);
  }
}
