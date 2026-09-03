/** git 配置功能：core 配置原语 → contracts GitConfigView 的薄映射；读写固定覆盖白名单全量键。 */
import { getGitConfigEntries, setGitConfigLocal } from '@rebased/core';
import { CONFIG_KEYS } from '@rebased/contracts';
import type { ConfigKey, ConfigPutBody, GitConfigView } from '@rebased/contracts';

export async function getRepoConfig(repoPath: string): Promise<GitConfigView> {
  const entries = await getGitConfigEntries(repoPath, [...CONFIG_KEYS]);
  // key 来自 CONFIG_KEYS 白名单，core 原样回传，故收敛为 ConfigKey
  return { entries: entries.map((e) => ({ key: e.key as ConfigKey, value: e.value, localValue: e.localValue })) };
}

export async function setRepoConfig(repoPath: string, body: ConfigPutBody): Promise<GitConfigView> {
  await setGitConfigLocal(repoPath, body.key, body.value);
  return getRepoConfig(repoPath); // 写 local 后返回刷新视图
}
