/** POST /api/repos/:repoId/autosquash —— zod 校验请求体 → applyAutosquash（fixup!/squash! 提交 + rebase -i --autosquash 折入）→ 200 RebaseOutcome */
import { applyAutosquash } from '@rebased/api';
import { autosquashBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = autosquashBodySchema.parse(await req.json());
    return Response.json(await applyAutosquash(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
