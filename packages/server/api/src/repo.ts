/** 仓库功能：打开（验证+注册）、最近列表、按 id 取、初始化、克隆。 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { cloneGitRepo, findRepoRoot, initGitRepo } from '@rebased/core';
import type { RepoInfo } from '@rebased/contracts';
import { ServiceError } from '@rebased/contracts';
import { loadConfig, saveConfig } from './lib/config-store';

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
  config.settings.recentRepoIds = [repo.id, ...config.settings.recentRepoIds.filter((id) => id !== repo.id)].slice(0, 20);
  saveConfig(config);
  return repo;
}

export function listRecentRepos(): RepoInfo[] {
  return loadConfig().repos.slice(0, 20);
}

export function getRepoById(id: string): RepoInfo {
  const repo = loadConfig().repos.find((r) => r.id === id);
  if (!repo) throw new ServiceError('REPO_NOT_FOUND', `仓库不存在或未打开：${id}`, { context: { id } });
  return repo;
}

export async function initRepo(path: string): Promise<RepoInfo> {
  await initGitRepo(path);
  return openRepo(path);
}

export async function cloneRepo(url: string, targetDir: string): Promise<RepoInfo> {
  await cloneGitRepo(url, targetDir);
  return openRepo(targetDir);
}
