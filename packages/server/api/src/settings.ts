/** 应用设置：UI 偏好（log 位置）与最近仓库 id + 保护分支模式；持久化复用 lib/config-store。 */
import { resolveGitExecutableInfo } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { GitExecutableInfo, SettingsPatch, SettingsState } from '@rebased/contracts';
import { loadConfig, saveConfig } from './lib/config-store';

/** 归一化视图：旧配置文件缺 protectedBranchPatterns 时补空列表（服务端保证字段存在） */
function normalizeSettings(settings: SettingsState): SettingsState {
  return { ...settings, protectedBranchPatterns: settings.protectedBranchPatterns ?? [] };
}

export function getSettings(): SettingsState {
  return normalizeSettings(loadConfig().settings);
}

/** 保护分支模式校验（GitVcsPanel.validateProtectedBranchesPatterns 语义：每项须为合法正则） */
function validateProtectedBranchPatterns(patterns: string[]): void {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new ServiceError('INVALID_QUERY', `保护分支模式不是有效正则：${pattern}`);
    }
  }
}

export function updateSettings(patch: SettingsPatch): SettingsState {
  if (patch.protectedBranchPatterns !== undefined) {
    validateProtectedBranchPatterns(patch.protectedBranchPatterns);
  }
  const config = loadConfig();
  config.settings = { ...config.settings, ...patch };
  saveConfig(config);
  return normalizeSettings(config.settings);
}

/** git 可执行文件检测（GitExecutableSelectorPanel 语义：PATH 查找 + 版本；不可执行 → ok:false 供引导） */
export function getGitExecutableInfo(): Promise<GitExecutableInfo> {
  return resolveGitExecutableInfo();
}
