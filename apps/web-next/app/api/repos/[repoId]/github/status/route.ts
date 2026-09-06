/** GET /api/repos/:repoId/github/status —— GitHub 域可用性三态（服务层不抛错）→ 200 GitHubStatus；未注册 repo → 404 */
import { getGithubStatus } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getGithubStatus(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
