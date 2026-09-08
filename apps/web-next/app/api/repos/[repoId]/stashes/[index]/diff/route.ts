/** GET /api/repos/:repoId/stashes/:index/diff —— 贮藏差异（git stash show -p）→ 200 StashDiff；索引越界 → 400 INVALID_REF */
import { getStashDiff } from '@rebased/api';
import { stashIndexSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string; index: string }> }): Promise<Response> {
  try {
    const { repoId, index: rawIndex } = await params;
    const { index } = stashIndexSchema.parse({ index: rawIndex });
    return Response.json(await getStashDiff(resolveRepo(z.string().min(1).parse(repoId)), index));
  } catch (error) {
    return handleApiError(error);
  }
}
