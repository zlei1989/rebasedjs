/** GET/PUT /api/repos/:repoId/settings/gpg-config —— GPG 提交签名配置（GitGpgConfigDialog 语义）：
 *  GET → GpgConfigView（启用态 + 选定密钥 + 可用密钥列表）；PUT（enabled=true 须带 key）→ 写 commit.gpgsign/user.signingkey → 200 刷新视图 */
import { getGpgSettings, setGpgSettings } from '@rebased/api';
import { gpgConfigBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getGpgSettings(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = gpgConfigBodySchema.parse(await req.json());
    return Response.json(await setGpgSettings(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
