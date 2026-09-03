/** GET /api/repos/:repoId/branches —— 分支列表；POST —— zod 校验 action → applyBranchAction → 返回刷新列表 */
import { applyBranchAction, getBranches } from '@rebased/api';
import { branchActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getBranches(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = branchActionSchema.parse(await req.json());
    return Response.json(await applyBranchAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
