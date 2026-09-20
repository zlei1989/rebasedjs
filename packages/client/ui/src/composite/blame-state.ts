/**
 * 溯源页三栏的**派生规则**（纯函数，无 React、无请求）：
 *   · 选中提交解析——URL 优先、清单首条兜底；
 *   · 变更集就绪判据——SWR 换键那一拍可能还挂着上一提交的数据；
 *   · 三种降级判据——根提交 / 重命名 / 该提交的版本里没有这个路径。
 * 为什么单独一个文件：两端容器与右栏组件都要这三件事，各写一份必然慢慢走偏
 * （口径来源见 design §3.1/§4）。
 */
import type { CommittedEntry, FileHistoryEntry } from '@rebased/contracts';

/** 右栏三个视图标签的键（也是 URL `?view=` 的取值域） */
export type BlameViewKey = 'changes' | 'latest' | 'annotate';

/**
 * 选中提交解析：URL 的 `?select=` 优先（陈旧深链——改名之前的提交、被重写掉的哈希——也要能看），
 * 否则回落清单首条（最新一条）——这样带 `?file=` 深链进来右栏立刻有内容，不必再点一次；
 * 清单也为空（未跟踪文件/空仓库）时给空串，调用方据此走空态、钩子挂 null key 不发请求。
 */
export function resolveBlameHash(urlHash: string | null, commits?: FileHistoryEntry[]): string {
  if (urlHash !== null && urlHash !== '') return urlHash;
  const first = commits?.[0];
  return first === undefined ? '' : first.hash;
}

/**
 * 变更集是否属于当前选中提交：SWR 换键那一拍 `data` 可能还是上一个提交的，
 * 判据必须是 `entry.hash === hash`，否则会拿旧变更集的父提交去拉差异（张冠李戴）。
 */
export function isEntryReady(entry: CommittedEntry | null | undefined, hash: string): boolean {
  return hash !== '' && entry !== null && entry !== undefined && entry.hash === hash;
}

/** 标签1/标签2 的降级判据（三种提示行的依据） */
export interface ChangesHints {
  /** 变更集是否已就绪且属于当前选中提交 */
  ready: boolean;
  /** 该提交是根提交（无父版本）→ 标签1 只给提示行、不发请求 */
  rootCommit: boolean;
  /** 该提交变更集里当前路径的改名原名（非空 → 重命名提示行，不做伪 diff） */
  renameFrom: string | undefined;
  /** 该提交动过文件，却唯独没有当前路径 → 这一版里这个路径还不存在（改名之前 / 尚未创建） */
  missingPath: boolean;
}

/**
 * 三种降级判据一次算全。**未就绪时三种标记一律不置位**——数据还没到，不能凭上一提交的变更集下结论。
 * 合并提交（多父且 git 默认不列文件）不判 missingPath：那会把它误报成「这一版没有这个路径」。
 */
export function changesHints(entry: CommittedEntry | null | undefined, hash: string, file: string): ChangesHints {
  if (!isEntryReady(entry, hash)) {
    return { ready: false, rootCommit: false, renameFrom: undefined, missingPath: false };
  }
  const ready = entry as CommittedEntry;
  const target = ready.files.find((f) => f.path === file);
  return {
    ready: true,
    rootCommit: ready.parents.length === 0,
    renameFrom: target === undefined ? undefined : target.renameFrom,
    missingPath: ready.files.length > 0 && target === undefined,
  };
}
