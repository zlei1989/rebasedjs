/** 应用设置：UI 偏好（log 位置）与最近仓库 id；持久化复用 lib/config-store。 */
import { resolveGitExecutableInfo } from '@rebased/core';
import type { GitExecutableInfo, SettingsPatch, SettingsState } from '@rebased/contracts';
import { loadConfig, saveConfig } from './lib/config-store';

export function getSettings(): SettingsState {
  return loadConfig().settings;
}

export function updateSettings(patch: SettingsPatch): SettingsState {
  const config = loadConfig();
  config.settings = { ...config.settings, ...patch };
  saveConfig(config);
  return config.settings;
}

/** git 可执行文件检测（GitExecutableSelectorPanel 语义：PATH 查找 + 版本；不可执行 → ok:false 供引导） */
export function getGitExecutableInfo(): Promise<GitExecutableInfo> {
  return resolveGitExecutableInfo();
}
