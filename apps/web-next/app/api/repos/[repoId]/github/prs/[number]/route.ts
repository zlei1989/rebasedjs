/** GET /api/repos/:repoId/github/prs/:number —— githubPrNumberSchema 校验路径参数 → getGithubPrDetail → 200 GitHubPrDetail；number 非法 → 400 */
import { getGithubPrDetail } from '@rebased/api';
import { githubPrNumberSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    return Response.json(await getGithubPrDetail(resolveRepo(z.string().min(1).parse(repoId)), number));
  } catch (error) {
    return handleApiError(error);
  }
}
