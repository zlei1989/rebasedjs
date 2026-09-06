/** GET /api/repos/:repoId/gitlab/mrs/:iid —— gitlabMrIidSchema 校验路径参数 → getGitlabMrDetail → 200 GitLabMrDetail；iid 非法 → 400 */
import { getGitlabMrDetail } from '@rebased/api';
import { gitlabMrIidSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; iid: string }> }): Promise<Response> {
  try {
    const { repoId, iid: rawIid } = await params;
    const { iid } = gitlabMrIidSchema.parse({ iid: rawIid });
    return Response.json(await getGitlabMrDetail(resolveRepo(z.string().min(1).parse(repoId)), iid));
  } catch (error) {
    return handleApiError(error);
  }
}
