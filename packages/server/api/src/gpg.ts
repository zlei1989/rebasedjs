/** GPG 提交签名配置功能（GitGpgConfigDialog / GpgSignConfigurableRow 语义）：启用态 + 选定密钥 + 可用密钥列表；写两键。 */
import { getGpgCommitConfig, listSecretGpgKeys, setGpgCommitConfig } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { GpgConfigBody, GpgConfigView } from '@rebased/contracts';

/** GPG 签名配置视图：enabled（commit.gpgsign 生效值）+ key（user.signingkey 生效值）+ 可用密钥列表（gpg 缺失 → 空列表） */
export async function getGpgSettings(repoPath: string): Promise<GpgConfigView> {
  const [config, keys] = await Promise.all([getGpgCommitConfig(repoPath), listSecretGpgKeys(repoPath)]);
  return { enabled: config.enabled, key: config.key, keys };
}

/** 写 GPG 签名配置（enabled=true 须带 key——schema refine + 本层预检双保险），返回刷新视图 */
export async function setGpgSettings(repoPath: string, body: GpgConfigBody): Promise<GpgConfigView> {
  const next =
    body.enabled && typeof body.key === 'string'
      ? { enabled: true, key: body.key }
      : { enabled: false, key: null };
  if (body.enabled && next.key === null) {
    throw new ServiceError('INVALID_QUERY', '启用提交签名必须选择密钥');
  }
  await setGpgCommitConfig(repoPath, next);
  return getGpgSettings(repoPath);
}
