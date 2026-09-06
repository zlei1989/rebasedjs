/** POST /api/repos/:repoId/github/prs/:number/merge —— zod 校验请求体 → mergeGithubPr → 200 GitHubPrMergeResult；method 非法 → 400 */
import { mergeGithubPr } from '@rebased/api';
import { githubMergeBodySchema, githubPrNumberSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    const body = githubMergeBodySchema.parse(await req.json());
    return Response.json(await mergeGithubPr(resolveRepo(z.string().min(1).parse(repoId)), number, body));
  } catch (error) {
    return handleApiError(error);
  }
}
