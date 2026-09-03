/** POST /api/repos/:repoId/operation/abort —— 中止当前操作 → 返回刷新状态；无进行中操作 → 400 INVALID_QUERY */
import { abortOperation } from '@rebased/api';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await abortOperation(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}
