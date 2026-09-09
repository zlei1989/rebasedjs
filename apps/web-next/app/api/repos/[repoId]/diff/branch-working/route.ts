/** GET /api/repos/:repoId/diff/branch-working —— zod 校验查询（branch）→ getBranchWorkingDiff
 *  （分支 vs 工作树：git diff <ref> --name-status 文件清单，GitShowDiffWithRefAction 语义）→ 200 BranchWorkingDiff */
import { getBranchWorkingDiff } from '@rebased/api';
import { branchWorkingDiffQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = branchWorkingDiffQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await getBranchWorkingDiff(resolveRepo(z.string().min(1).parse(repoId)), query.branch));
  } catch (error) {
    return handleApiError(error);
  }
}
