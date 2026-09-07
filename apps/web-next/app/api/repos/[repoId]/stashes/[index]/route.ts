/**
 * GET /api/repos/:repoId/stashes/:index/diff —— 贮藏差异（git stash show -p）→ 200 StashDiff；索引越界 → 400 INVALID_REF
 * POST /api/repos/:repoId/stashes/unstash-as —— Unstash As（检出目标分支 + apply，不 drop）→ 200 StashList；body 校验 → 400
 */
import { getStashDiff, unstashAs } from '@rebased/api';
import { stashIndexSchema, stashUnstashAsBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string; index: string }> }): Promise<Response> {
  try {
    const { repoId, index: rawIndex } = await params;
    const { index } = stashIndexSchema.parse({ index: rawIndex });
    return Response.json(await getStashDiff(resolveRepo(z.string().min(1).parse(repoId)), index));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; index: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = stashUnstashAsBodySchema.parse(await req.json());
    return Response.json(await unstashAs(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
