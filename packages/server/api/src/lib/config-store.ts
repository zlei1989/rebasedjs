/** 应用配置持久化（内部基础设施，不进公共出口）：JSON 文件 + 原子可覆盖写。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RepoInfo, SettingsState } from '@rebased/contracts';

export interface AppConfig {
  repos: RepoInfo[];
  settings: SettingsState;
}

const DEFAULTS: AppConfig = {
  repos: [],
  settings: { logInEditor: true, recentRepoIds: [] },
};

/** 配置目录：REBASED_CONFIG_DIR（测试）> ~/.rebasedjs（生产） */
export function getConfigDir(): string {
  return process.env.REBASED_CONFIG_DIR ?? join(homedir(), '.rebasedjs');
}

function configFile(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): AppConfig {
  const file = configFile();
  if (!existsSync(file)) return structuredClone(DEFAULTS);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
  return { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...parsed.settings } };
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf8');
}
