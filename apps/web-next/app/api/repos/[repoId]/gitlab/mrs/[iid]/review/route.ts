/** POST /api/repos/:repoId/gitlab/mrs/:iid/review —— zod 校验请求体 → submitGitlabMrReview → 200 刷新 GitLabMrDetail；event 非法 → 400 */
import { submitGitlabMrReview } from '@rebased/api';
import { gitlabMrIidSchema, gitlabReviewBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    const body = gitlabReviewBodySchema.parse(await req.json());
    return Response.json(await submitGitlabMrReview(resolveRepo(z.string().min(1).parse(repoId)), iid, body));
  } catch (error) {
    return handleApiError(error);
  }
}
