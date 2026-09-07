/** GET /api/app/home-dir —— getAppHomeDir（宿主用户主目录，路径副文本 ~/ 相对化显示用）→ 200 {homeDir} */
import { getAppHomeDir } from '@rebased/api';
import { handleApiError } from '../../../../src/server-context';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ homeDir: getAppHomeDir() });
  } catch (error) {
    return handleApiError(error);
  }
}
