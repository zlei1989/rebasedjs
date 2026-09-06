/** POST /api/repos/:repoId/ignore/add —— zod 校验请求体（契约仅 {path}）→ addIgnore（固定追加到 .gitignore）→ 200 刷新视图 */
import { addIgnore } from '@rebased/api';
import { ignoreAddBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = ignoreAddBodySchema.parse(await req.json());
    return Response.json(await addIgnore(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
