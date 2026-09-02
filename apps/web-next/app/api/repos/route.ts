/** GET /api/repos —— 最近仓库列表 */
import { listRecentRepos } from '@rebased/api';
import { handleApiError } from '../../../src/server-context';

export async function GET(): Promise<Response> {
  try {
    return Response.json(listRecentRepos());
  } catch (error) {
    return handleApiError(error);
  }
}
