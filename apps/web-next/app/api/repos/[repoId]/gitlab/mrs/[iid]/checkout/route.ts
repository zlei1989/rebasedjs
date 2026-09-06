/** POST /api/repos/:repoId/gitlab/mrs/:iid/checkout —— 路径参数校验（无请求体）→ checkoutGitlabMr → 200 {branchName:'mr-N'}；无远程 → 400 */
import { checkoutGitlabMr } from '@rebased/api';
import { gitlabMrIidSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    return Response.json(await checkoutGitlabMr(resolveRepo(z.string().min(1).parse(repoId)), iid));
  } catch (error) {
    return handleApiError(error);
  }
}
