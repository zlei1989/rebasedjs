/** GET /api/repos/:repoId/github/prs/:number/files —— 路径参数校验 → getGithubPrFiles → 200 GitHubPrFiles（patch 缺省 → ''） */
import { getGithubPrFiles } from '@rebased/api';
import { githubPrNumberSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; number: string }> }): Promise<Response> {
  try {
    const { repoId, number: rawNumber } = await params;
    const { number } = githubPrNumberSchema.parse({ number: rawNumber });
    return Response.json(await getGithubPrFiles(resolveRepo(z.string().min(1).parse(repoId)), number));
  } catch (error) {
    return handleApiError(error);
  }
}
