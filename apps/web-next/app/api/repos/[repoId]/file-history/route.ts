/** GET /api/repos/:repoId/file-history —— zod 校验查询 → getFileHistoryLog（--follow 跟随重命名）→ 200 FileHistoryEntry[] */
import { getFileHistoryLog } from '@rebased/api';
import { fileHistoryQuerySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = fileHistoryQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const entries = await getFileHistoryLog(resolveRepo(z.string().min(1).parse(repoId)), query.file);
    return Response.json(entries);
  } catch (error) {
    return handleApiError(error);
  }
}
