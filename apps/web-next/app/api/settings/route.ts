/** /api/settings —— GET 读设置；PUT zod 校验补丁 → updateSettings → 返回更新后完整设置 */
import { getSettings, updateSettings } from '@rebased/api';
import { settingsPatchSchema } from '@rebased/contracts';
import { handleApiError } from '../../../src/server-context';

export async function GET(): Promise<Response> {
  try {
    return Response.json(getSettings());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const patch = settingsPatchSchema.parse(await req.json());
    return Response.json(updateSettings(patch));
  } catch (error) {
    return handleApiError(error);
  }
}
