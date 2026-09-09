/** GET /api/settings/git-executable —— git 可执行文件检测（GitExecutableSelectorPanel 语义：PATH 查找 + 版本）→ 200 GitExecutableInfo */
import { getGitExecutableInfo } from '@rebased/api';
import { handleApiError } from '../../../../src/server-context';

export async function GET(_req: Request): Promise<Response> {
  try {
    return Response.json(await getGitExecutableInfo());
  } catch (error) {
    return handleApiError(error);
  }
}
