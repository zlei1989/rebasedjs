/** POST /api/repos/:repoId/gitlab/mrs/:iid/merge —— zod 校验请求体 → mergeGitlabMr → 200 GitLabMrMergeResult；squash 类型非法 → 400 */
import { mergeGitlabMr } from '@rebased/api';
import { gitlabMergeBodySchema, gitlabMrIidSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    const body = gitlabMergeBodySchema.parse(await req.json());
    return Response.json(await mergeGitlabMr(resolveRepo(z.string().min(1).parse(repoId)), iid, body));
  } catch (error) {
    return handleApiError(error);
  }
}
