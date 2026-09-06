/** GET /api/repos/:repoId/github/prs/:number/timeline —— 路径参数校验 → getGithubPrTimeline（comments+reviews 合并升序）→ 200 GitHubTimeline */
import { getGithubPrTimeline } from '@rebased/api';
import { githubPrNumberSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    return Response.json(await getGithubPrTimeline(resolveRepo(z.string().min(1).parse(repoId)), number));
  } catch (error) {
    return handleApiError(error);
  }
}
