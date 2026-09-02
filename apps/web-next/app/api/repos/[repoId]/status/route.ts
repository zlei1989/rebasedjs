/** GET /api/repos/:repoId/status —— repoId 解析 → getRepoStatus → 错误映射 */
import { getRepoStatus } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const status = await getRepoStatus(resolveRepo(z.string().min(1).parse(repoId)));
    return Response.json(status);
  } catch (error) {
    return handleApiError(error);
  }
}
