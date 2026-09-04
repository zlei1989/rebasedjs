/** POST /api/repos/:repoId/cherry-pick —— zod 校验请求体 → cherryPick（逐哈希预检后按序应用）→ 200 PickOutcome */
import { cherryPick } from '@rebased/api';
import { pickBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = pickBodySchema.parse(await req.json());
    return Response.json(await cherryPick(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
