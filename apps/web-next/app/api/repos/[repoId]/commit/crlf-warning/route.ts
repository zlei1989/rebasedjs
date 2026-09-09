/** GET /api/repos/:repoId/commit/crlf-warning —— CRLF 提示（GitCrlfDialog 检测：Windows + autocrlf 未建议 + 暂存文件 CRLF 无属性覆盖）→ 200 CrlfWarning */
import { getCrlfWarning } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getCrlfWarning(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
