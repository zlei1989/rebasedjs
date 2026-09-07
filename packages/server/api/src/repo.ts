/** 仓库功能：打开（验证+注册）、最近列表、按 id 取、初始化、克隆、移除。 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { cloneGitRepo, findRepoRoot, initGitRepo } from '@rebased/core';
import type { RepoInfo } from '@rebased/contracts';
import { ServiceError } from '@rebased/contracts';
import { loadConfig, saveConfig, type ChangelistBook } from './lib/config-store';

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

export function listRecentRepos(): RepoInfo[] {
  return loadConfig().repos.slice(0, RECENT_LIMIT);
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
