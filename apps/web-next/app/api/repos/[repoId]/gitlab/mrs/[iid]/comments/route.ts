/** POST /api/repos/:repoId/gitlab/mrs/:iid/comments —— zod 校验请求体 → addGitlabMrComment → 200 刷新 GitLabTimeline；body 空/超长 → 400 */
import { addGitlabMrComment } from '@rebased/api';
import { gitlabCommentBodySchema, gitlabMrIidSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    const body = gitlabCommentBodySchema.parse(await req.json());
    return Response.json(await addGitlabMrComment(resolveRepo(z.string().min(1).parse(repoId)), iid, body.body));
  } catch (error) {
    return handleApiError(error);
  }
}
