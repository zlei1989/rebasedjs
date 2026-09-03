/** GET /api/repos/:repoId/conflicts —— 冲突列表（path + 存在阶段）→ 200 ConflictList；无冲突为空列表 */
import { getConflicts } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getConflicts(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
