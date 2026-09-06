/** GET /api/repos/:repoId/ignore/templates —— 内建忽略模板（无参 GET，服务不触盘）；repoId 仍校验（与其余 repo 域端点一致：未注册 → 404 REPO_NOT_FOUND） */
import { getIgnoreTemplates } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    resolveRepo(z.string().min(1).parse(repoId));
    return Response.json(getIgnoreTemplates());
  } catch (error) {
    return handleApiError(error);
  }
}
