/**
 * 变更列表功能：应用层簿记（git 无原生变更列表概念），按 repoId 持久化在应用配置中；
 * 读取时与实时 git status 合并——assignments 只保留 status 现存路径（修剪后回写配置）。
 */
import { randomUUID } from 'node:crypto';
import type { Changelist, ChangelistAction, ChangelistView } from '@rebased/contracts';
import { ServiceError } from '@rebased/contracts';
import type { AppConfig, ChangelistBook } from './lib/config-store';
import { loadConfig, saveConfig } from './lib/config-store';
import { getRepoStatus } from './status';

/** 默认列表：id 固定 'default'，接收所有未分配路径 */
const DEFAULT_LIST: Changelist = { id: 'default', name: '默认', isDefault: true };

/** repoPath → repoId：经 config.repos 注册表反查；未注册 → REPO_NOT_FOUND（防御，路由层 resolveRepo 保证注册在先） */
function repoIdOf(config: AppConfig, repoPath: string): string {
  const repo = config.repos.find((r) => r.path === repoPath);
  if (!repo) {
    throw new ServiceError('REPO_NOT_FOUND', `仓库不存在或未打开：${repoPath}`, { context: { path: repoPath } });
  }
  return repo.id;
}

/** 判定簿记形状合法：lists 为数组且 assignments 为对象（手改损坏的字段不算数） */
function isBook(raw: unknown): raw is ChangelistBook {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as ChangelistBook).lists) &&
    typeof (raw as ChangelistBook).assignments === 'object' &&
    (raw as ChangelistBook).assignments !== null
  );
}

/** 取簿记；无簿记或形状损坏（手改配置）时初始化默认列表——自愈而非抛 500（调用方负责落盘时机） */
function bookOf(config: AppConfig, repoId: string): ChangelistBook {
  // changelists 整体非对象 → 重置为空注册表
  if (typeof config.changelists !== 'object' || config.changelists === null) config.changelists = {};
  if (!isBook(config.changelists[repoId])) {
    config.changelists[repoId] = { lists: [structuredClone(DEFAULT_LIST)], assignments: {} };
  }
  return config.changelists[repoId];
}

/**
 * 变更列表视图：簿记 + 实时 status 合并——assignments 修剪掉 status 中已不存在的路径（修剪后回写配置）；
 * 仓库无簿记时初始化默认列表「默认」（id 固定 'default'）
 */
export async function getChangelists(repoPath: string): Promise<ChangelistView> {
  // await 前的读仅用于 repoId 反查；簿记读写全部放在 await 之后，避免持有过期配置对象
  const repoId = repoIdOf(loadConfig(), repoPath);
  const status = await getRepoStatus(repoPath);
  const live = new Set(status.entries.map((e) => e.path));

  // 竞态防线（P2-G 终审）：await 后重新 loadConfig 再合并写回——只删失效路径条目、簿记缺失才初始化，
  // 不做整体替换；否则 await 期间的并发配置写入（openRepo/updateSettings/变更列表操作）会被过期整体写覆盖
  const config = loadConfig();
  const needsInit = !isBook(config.changelists?.[repoId]);
  const book = bookOf(config, repoId);
  // 修剪：剔除 status 已不存在的路径（提交/还原/删除后簿记失效）
  const assignments = Object.fromEntries(Object.entries(book.assignments).filter(([path]) => live.has(path)));
  const pruned = Object.keys(assignments).length !== Object.keys(book.assignments).length;
  // 修剪有变化或簿记初始化/自愈时回写配置，复用既有原子保存
  if (pruned || needsInit) {
    book.assignments = assignments;
    saveConfig(config);
  }
  return { lists: book.lists, assignments };
}

/**
 * 变更列表操作分派：create（名重复 → INVALID_QUERY '列表已存在：…'）；rename；delete（默认列表 →
 * INVALID_QUERY '默认列表不可删除'；其文件归默认列表）；setDefault；move（targetId 不存在 →
 * INVALID_QUERY '列表不存在：…'）；每次操作后返回刷新视图
 */
export async function applyChangelistAction(repoPath: string, action: ChangelistAction): Promise<ChangelistView> {
  const config = loadConfig();
  const book = bookOf(config, repoIdOf(config, repoPath));

  switch (action.action) {
    case 'create': {
      if (book.lists.some((l) => l.name === action.name)) {
        throw new ServiceError('INVALID_QUERY', `列表已存在：${action.name}`);
      }
      book.lists.push({ id: randomUUID(), name: action.name, isDefault: false });
      break;
    }
    case 'rename': {
      const list = book.lists.find((l) => l.id === action.id);
      if (!list) throw new ServiceError('INVALID_QUERY', `列表不存在：${action.id}`);
      list.name = action.name;
      break;
    }
    case 'delete': {
      const list = book.lists.find((l) => l.id === action.id);
      if (!list) throw new ServiceError('INVALID_QUERY', `列表不存在：${action.id}`);
      if (list.isDefault) throw new ServiceError('INVALID_QUERY', '默认列表不可删除');
      book.lists = book.lists.filter((l) => l.id !== action.id);
      // 被删列表的文件归默认：移除显式 assignment 即落回默认列表
      book.assignments = Object.fromEntries(
        Object.entries(book.assignments).filter(([, listId]) => listId !== action.id),
      );
      break;
    }
    case 'setDefault': {
      const list = book.lists.find((l) => l.id === action.id);
      if (!list) throw new ServiceError('INVALID_QUERY', `列表不存在：${action.id}`);
      for (const l of book.lists) l.isDefault = l.id === action.id;
      break;
    }
    case 'move': {
      if (!book.lists.some((l) => l.id === action.targetId)) {
        throw new ServiceError('INVALID_QUERY', `列表不存在：${action.targetId}`);
      }
      for (const path of action.paths) book.assignments[path] = action.targetId;
      break;
    }
  }

  saveConfig(config);
  // 返回刷新视图：与实时 status 合并并修剪
  return getChangelists(repoPath);
}
