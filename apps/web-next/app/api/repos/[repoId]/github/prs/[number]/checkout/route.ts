/** POST /api/repos/:repoId/github/prs/:number/checkout —— 路径参数校验（无请求体）→ checkoutGithubPr → 200 {branchName:'pr-N'}；无远程 → 400 */
import { checkoutGithubPr } from '@rebased/api';
import { githubPrNumberSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    return Response.json(await checkoutGithubPr(resolveRepo(z.string().min(1).parse(repoId)), number));
  } catch (error) {
    return handleApiError(error);
  }
}
