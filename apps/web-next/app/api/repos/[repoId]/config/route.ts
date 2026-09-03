/** GET /api/repos/:repoId/config —— repoId 解析 → getRepoConfig → 错误映射；PUT zod 校验 → setRepoConfig → 返回刷新视图 */
import { getRepoConfig, setRepoConfig } from '@rebased/api';
import { configPutBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getRepoConfig(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = configPutBodySchema.parse(await req.json());
    return Response.json(await setRepoConfig(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
