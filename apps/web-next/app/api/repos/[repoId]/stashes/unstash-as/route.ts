/** POST /api/repos/:repoId/stashes/unstash-as —— Unstash As（检出目标分支 + apply，不 drop）→ 200 StashList；body 校验 → 400 */
import { unstashAs } from '@rebased/api';
import { stashUnstashAsBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = stashUnstashAsBodySchema.parse(await req.json());
    return Response.json(await unstashAs(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
