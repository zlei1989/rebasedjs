/** POST /api/repos/:repoId/patches/:name/import-shelf —— 导入补丁为搁置（ImportIntoShelfAction）→ 200 ShelfList；重名 → 400 INVALID_QUERY、补丁不存在 → 400 INVALID_REF */
import { importPatchIntoShelf } from '@rebased/api';
import { patchImportShelfSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../../src/server-context';

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; name: string }> }): Promise<Response> {
  try {
    const { repoId, name: rawName } = await params;
    const { name } = patchImportShelfSchema.parse({ name: rawName });
    return Response.json(await importPatchIntoShelf(resolveRepo(z.string().min(1).parse(repoId)), name));
  } catch (error) {
    return handleApiError(error);
  }
}
