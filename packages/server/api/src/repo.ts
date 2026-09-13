/** 仓库功能：打开（验证+注册）、最近列表、按 id 取、初始化、克隆、移除。 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { cloneGitRepo, findRepoRoot, initGitRepo, readHeadBranch } from '@rebased/core';
import type { RecentRepoInfo, RepoInfo } from '@rebased/contracts';
import { ServiceError } from '@rebased/contracts';
import { loadConfig, saveConfig, type AppConfig, type ChangelistBook } from './lib/config-store';

/** 最近列表上限：对齐 Java RecentProjectsManagerBase（Web 组件 fetch 后亦按此截断，两端同口径） */
export const RECENT_LIMIT = 50;

/** 验证 path 是 git 仓库并注册到最近列表（同路径复用既有 id） */
export async function openRepo(path: string): Promise<RepoInfo> {
  const root = await findRepoRoot(path);
  if (root === null) throw new ServiceError('NOT_A_GIT_REPO', `不是 git 仓库：${path}`, { context: { path } });

  const config = loadConfig();
  const existing = config.repos.find((r) => r.path === root);
  const repo: RepoInfo = existing ?? {
    id: randomUUID(),
    path: root,
    name: basename(root),
    openedAt: new Date().toISOString(),
  };
  repo.openedAt = new Date().toISOString();
  config.repos = [repo, ...config.repos.filter((r) => r.id !== repo.id)];
  config.settings.recentRepoIds = [repo.id, ...config.settings.recentRepoIds.filter((id) => id !== repo.id)].slice(0, RECENT_LIMIT);
  saveConfig(config);
  return repo;
}

/** 头像色板容量 = ProjectIconPalette.gradients.size（Java RecentProjectColorPalette.COLOR_COUNT = 9） */
const AVATAR_COLOR_COUNT = 9;

/**
 * 路径是否存在且为目录（RecentProjectPanel.isPathValid 的等价）：
 * 只看目录存在性——路径在但已不是 git 仓库时仍算可用（打开时由 openRepo 报 NOT_A_GIT_REPO）。
 */
async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 取或分配某路径的头像色号（逐句对齐 Java ProjectWindowCustomizerService.getOrGenerateAssociatedColorIndex:327-343）。
 * 做什么：簿记里已有该路径且色号有效（整数、落在 [0, 9)）→ 直接复用；否则取新号并写回簿记。
 * 怎么做：新号 = ((lastIndex ?? 随机(0..8)) + 1) % 9 —— Java nextColorIndex:452-457 的等价
 *        （首次默认值是 `Random().nextInt(colorsCount)`，之后每次在「上次分配出去的号」上 +1 回绕）。
 * 注意：色号按**路径**持久化、不随 removeRepo 清理——重新加入同一路径会沿用原色号（Java 亦如此，
 *      色存储挂在项目路径上而非最近列表条目上）。
 * 返回值 `assigned` 供调用方决定是否写盘（只在真的分配过时保存）。
 */
function resolveAvatarColorIndex(config: AppConfig, path: string): { colorIndex: number; assigned: boolean } {
  const book = config.avatarColors;
  const stored = book?.index[path];
  if (stored !== undefined && Number.isInteger(stored) && stored >= 0 && stored < AVATAR_COLOR_COUNT) {
    return { colorIndex: stored, assigned: false };
  }
  const randomDefault = Math.floor(Math.random() * AVATAR_COLOR_COUNT);
  const colorIndex = ((book?.lastIndex ?? randomDefault) + 1) % AVATAR_COLOR_COUNT;
  config.avatarColors = { index: { ...book?.index, [path]: colorIndex }, lastIndex: colorIndex };
  return { colorIndex, assigned: true };
}

/**
 * 最近仓库列表：逐仓现算 branch（读 .git/HEAD）、valid（路径存在性）与 colorIndex（头像色号）。
 * branch/valid **不落盘**（配置里存的仍是四字段 RepoInfo，陈旧分支名因此不可能出现）；
 * colorIndex 是**持久化簿记**——对齐 Java 的按项目色号，只在首次遇见某路径时写一次配置。
 * 怎么做：上限 50 条 ⇒ 至多 50 组并发 stat + readFile，**不产生 git 子进程**。
 */
export async function listRecentRepos(): Promise<RecentRepoInfo[]> {
  const config = loadConfig();
  const repos = config.repos.slice(0, RECENT_LIMIT);
  let touched = false;
  const withAvatar = repos.map((repo) => {
    const { colorIndex, assigned } = resolveAvatarColorIndex(config, repo.path);
    if (assigned) touched = true;
    return { repo, colorIndex };
  });
  // 只在真的分配了新色号时写盘（对齐 Java getOrGenerateAssociatedColorIndex 的保存时机）
  if (touched) saveConfig(config);
  return Promise.all(
    withAvatar.map(async ({ repo, colorIndex }) => ({
      ...repo,
      colorIndex,
      branch: await readHeadBranch(repo.path),
      valid: await pathIsDirectory(repo.path),
    })),
  );
}

export function getRepoById(id: string): RepoInfo {
  const repo = loadConfig().repos.find((r) => r.id === id);
  if (!repo) throw new ServiceError('REPO_NOT_FOUND', `仓库不存在或未打开：${id}`, { context: { id } });
  return repo;
}

/** 从最近列表移除（幂等）：同时清理 recentRepoIds 与该仓库的变更列表簿记 */
export function removeRepo(id: string): void {
  const config = loadConfig();
  config.repos = config.repos.filter((r) => r.id !== id);
  config.settings.recentRepoIds = config.settings.recentRepoIds.filter((rid) => rid !== id);
  if (config.changelists !== undefined) {
    const rest: Record<string, ChangelistBook> = {};
    for (const [bookId, book] of Object.entries(config.changelists)) {
      if (bookId !== id) rest[bookId] = book;
    }
    config.changelists = rest;
  }
  saveConfig(config);
}

/** 应用宿主用户主目录：路径副文本 `~/` 相对化显示用（容器注入 ui；浏览器端无法读 os.homedir） */
export function getAppHomeDir(): string {
  return homedir();
}

export async function initRepo(path: string): Promise<RepoInfo> {
  await initGitRepo(path);
  return openRepo(path);
}

export async function cloneRepo(url: string, targetDir: string): Promise<RepoInfo> {
  await cloneGitRepo(url, targetDir);
  return openRepo(targetDir);
}
