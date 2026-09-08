/** GET /api/repos/:repoId/commits/:hash —— 单提交变更文件（Show All Affected 语义 #34）→ 200 CommittedEntry；hash 无效 → 400 INVALID_REF */
import { getCommitFiles } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; hash: string }> }): Promise<Response> {
  try {
    const { repoId, hash } = await params;
    return Response.json(await getCommitFiles(resolveRepo(z.string().min(1).parse(repoId)), z.string().min(1).parse(hash)));
  } catch (error) {
    return handleApiError(error);
  }
}
