/** GET /api/repos/:repoId/gitlab/mrs/:iid/timeline —— 路径参数校验 → getGitlabMrTimeline（notes+reviews 合并升序）→ 200 GitLabTimeline */
import { getGitlabMrTimeline } from '@rebased/api';
import { gitlabMrIidSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    return Response.json(await getGitlabMrTimeline(resolveRepo(z.string().min(1).parse(repoId)), iid));
  } catch (error) {
    return handleApiError(error);
  }
}
