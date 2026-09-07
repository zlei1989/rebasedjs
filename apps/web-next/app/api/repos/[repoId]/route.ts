/** DELETE /api/repos/:repoId —— removeRepo（最近列表移除，幂等）→ {ok:true} */
import { removeRepo } from '@rebased/api';
import { z } from 'zod';
import { handleApiError } from '../../../../src/server-context';

export async function DELETE(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    removeRepo(z.string().min(1).parse(repoId));
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
