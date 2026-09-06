/** POST /api/repos/:repoId/github/prs/:number/review —— zod 校验请求体 → submitGithubPrReview → 200 刷新 GitHubPrDetail；event 非法 → 400 */
import { submitGithubPrReview } from '@rebased/api';
import { githubPrNumberSchema, githubReviewBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    const body = githubReviewBodySchema.parse(await req.json());
    return Response.json(await submitGithubPrReview(resolveRepo(z.string().min(1).parse(repoId)), number, body));
  } catch (error) {
    return handleApiError(error);
  }
}
