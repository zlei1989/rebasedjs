/** POST /api/repos/:repoId/github/prs/:number/comments —— zod 校验请求体 → addGithubPrComment → 200 刷新 GitHubTimeline；body 空/超长 → 400 */
import { addGithubPrComment } from '@rebased/api';
import { githubCommentBodySchema, githubPrNumberSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    const body = githubCommentBodySchema.parse(await req.json());
    return Response.json(await addGithubPrComment(resolveRepo(z.string().min(1).parse(repoId)), number, body.body));
  } catch (error) {
    return handleApiError(error);
  }
}
