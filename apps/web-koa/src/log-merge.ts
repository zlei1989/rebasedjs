/**
 * LogPage 容器流式合并语义（Ruling 6）：log/stream 是同一查询的渐进式渲染（整段日志逐块流式呈现），
 * 不是"页面加载后的新增"。故流连接中以流结果为主列表；REST 快照仅作首屏与去重兜底——
 * 先流后快照按 hash 合并，同 hash 取流（流侧是最新呈现）。流未连接时回退快照。
 * （与 web-next src/log-merge.ts 同构；apps 间互禁边界故各持一份。）
 */
import type { CommitInfo } from '@rebased/contracts';

export function mergeLogCommits(pageCommits: CommitInfo[], streamCommits: CommitInfo[], connected: boolean): CommitInfo[] {
  if (!connected) return pageCommits;
  const seen = new Set(streamCommits.map((c) => c.hash));
  return [...streamCommits, ...pageCommits.filter((c) => !seen.has(c.hash))];
}
