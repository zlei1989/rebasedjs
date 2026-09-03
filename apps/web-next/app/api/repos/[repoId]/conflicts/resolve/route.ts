/** POST /api/repos/:repoId/conflicts/resolve —— zod 校验请求体 → resolveConflict（ours/theirs 整侧采纳 / manual 写入合并结果）→ 200 刷新 ConflictList；非冲突路径 → 400 INVALID_QUERY */
import { resolveConflict } from '@rebased/api';
import { resolveConflictBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = resolveConflictBodySchema.parse(await req.json());
    return Response.json(await resolveConflict(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
