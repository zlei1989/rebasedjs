/** 应用配置持久化（内部基础设施，不进公共出口）：JSON 文件 + 原子可覆盖写。 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Changelist, RepoInfo, SettingsState } from '@rebased/contracts';
import { ServiceError } from '@rebased/contracts';

/** 单仓库的变更列表簿记：lists 为列表定义；assignments 为 路径 → listId */
export interface ChangelistBook {
  lists: Changelist[];
  assignments: Record<string, string>;
}

/**
 * 已存账户（内部簿记）：token 为明文落盘。
 * 安全取舍：服务端需要原 token 才能代为调用远端 git/host API，无法只存哈希；
 * 缓解措施是配置文件 0600（见 saveConfig）+ 对外出口一律掩码（见 auth.ts）。
 */
export interface StoredAccount {
  host: string;
  account: string;
  token: string;
}

export interface AppConfig {
  repos: RepoInfo[];
  settings: SettingsState;
  /** 变更列表簿记（按 repoId 键控）：可选——旧配置文件无此字段，读取时按 undefined 处理 */
  changelists?: Record<string, ChangelistBook>;
  /** 账户/令牌簿记：可选——旧配置文件无此字段，读取时按 undefined 处理 */
  auth?: { accounts: StoredAccount[] };
}

const DEFAULTS: AppConfig = {
  repos: [],
  settings: { logInEditor: true, recentRepoIds: [], protectedBranchPatterns: [], theme: 'dark' },
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
  // 容忍外部工具写入的 UTF-8 BOM：PowerShell 5.1 的 Set-Content/Out-File/ConvertTo-Json 默认带 BOM，
  // 而 `JSON.parse` 遇到 U+FEFF 会直接抛 SyntaxError——该异常冒到路由层会被误报成
  // 「请求体不是合法 JSON」的 400 并让全站不可用（冒烟 D-42 实测事故；应用自身写盘不产 BOM）。
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    const parsed = JSON.parse(text) as Partial<AppConfig>;
    return { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...parsed.settings } };
  } catch (error) {
    // 配置文件真的坏了：抛可直接展示的中文原因（含路径），别让 SyntaxError 冒充「请求体不是合法 JSON」
    throw new ServiceError(
      'GIT_ERROR',
      `配置文件不是合法 JSON：${file}（${error instanceof Error ? error.message : String(error)}）`,
      { cause: error },
    );
  }
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(getConfigDir(), { recursive: true });
  const file = configFile();
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  // 配置含明文凭据，写盘后收紧为属主独占读写 0600。
  // 平台语义：POSIX 下 chmod 精确生效；Windows 无 POSIX 权限位，chmod 仅能近似切换只读位，
  // 属主独占实际由 NTFS ACL/用户目录隔离承担——此处尽力而为、失败不报错（包 try/catch 静默）。
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows/特殊文件系统上尽力而为，不阻断保存
  }
}
