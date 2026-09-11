/** 日志 hooks：分页 SWR + 累积分页（按需加载到最早一条）+ SSE 增量流（commits 增量追加 + connected/error 状态） */
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { CommitInfo, LogPage, LogQuery } from '@rebased/contracts';
import { getJson } from './http';
import { subscribeSse } from './events';

/** 首屏页大小（与 log/stream 的查询一致：默认视图第一页与流同查询，可流式合并） */
export const LOG_FIRST_PAGE = 50;
/** 单页上限：服务端 log 端点 limit 上限（contracts/logQuerySchema 的 .max(500)），按此封顶 */
export const LOG_MAX_PAGE = 500;

/**
 * 第 index 页的页大小：50 → 100 → 200 → 400 → 500 → 500 …
 * 为什么阶梯放大而不是固定页大小：页数是 O(log N)——32 万条提交也只需 ~11 次请求就能走到最早一条；
 * 固定 50 则要 6400 次请求，用户「按需」滚动到仓库开头会退化成上千次往返。
 */
export function logPageSize(index: number): number {
  return Math.min(LOG_MAX_PAGE, LOG_FIRST_PAGE * 2 ** index);
}

/**
 * 第 index 页的 skip：前面各页大小之和（唯一真源是 logPageSize，避免两处各算一遍而错位）。
 * skip 必须等于「已加载条数」，否则相邻页会重叠或跳条——这是分页累积最容易错的一处。
 */
export function logPageSkip(index: number): number {
  let skip = 0;
  for (let i = 0; i < index; i++) skip += logPageSize(i);
  return skip;
}

/**
 * 按需累积拉取提交历史：GET /api/repos/:repoId/log?limit&skip&author&path，逐页追加直到「最早的一条」。
 *
 * 做什么：把服务端 500 上限的分页拼成一条不断增长的列表 —— commits 为已加载页的拼接（按 hash 去重），
 *        hasMore 取最后一页的 hasMore，loadMore 追加下一页；页末 hasMore=false（即已到仓库第一条）后
 *        再调 loadMore 不会发请求（SWRInfinite 的 key 返回 null 即停）。
 * 怎么做：useSWRInfinite 的 getKey 只用 index 就能算出 (limit, skip)（见 logPageSize/logPageSkip），
 *        不依赖已有数据长度，故不存在「先有鸡还是先有蛋」的 skip 计算。
 * 注意 revalidateFirstPage:false —— 追加页（setSize）时只有新页会请求（第一页不再被顺带重取）；
 *        而容器显式 mutate() 走的另一条路径（SWR 内部 forceRevalidateAll = true）会把**所有已加载页**
 *        重取一遍，故「提交/变基后列表刷新」不受影响。
 */
export function useLogPages(repoId: string, query?: { author?: string; path?: string }) {
  const author = query?.author ?? '';
  const path = query?.path ?? '';
  const { data, size, setSize, isLoading, error, mutate } = useSWRInfinite<LogPage>(
    (index, previousPage) => {
      // '' = 条件拉取关闭（无仓库）；上一页没满 = 已到最早的提交，不再要下一页
      if (repoId === '') return null;
      if (index > 0 && previousPage !== null && previousPage !== undefined && !previousPage.hasMore) return null;
      const params = new URLSearchParams();
      params.set('limit', String(logPageSize(index)));
      params.set('skip', String(logPageSkip(index)));
      if (author !== '') params.set('author', author);
      if (path !== '') params.set('path', path);
      return `/api/repos/${repoId}/log?${params.toString()}`;
    },
    getJson,
    // 追加页只请求新页（第一页不重取）：见上方注释——显式 mutate() 仍会重取全部已加载页
    { revalidateFirstPage: false },
  );
  // data 在「某页尚未回来」时该槽位为 undefined：先滤掉，再拼接
  const pages = useMemo(() => (data ?? []).filter((p): p is LogPage => p !== undefined), [data]);
  const commits = useMemo(() => {
    const seen = new Set<string>();
    const merged: CommitInfo[] = [];
    for (const page of pages) {
      for (const commit of page.commits) {
        if (seen.has(commit.hash)) continue;
        seen.add(commit.hash);
        merged.push(commit);
      }
    }
    return merged;
  }, [pages]);
  const lastPage = pages.length > 0 ? pages[pages.length - 1] : undefined;
  const hasMore = lastPage?.hasMore === true;
  /**
   * 「追加页是否已在路上」= 请求的页数（size）还没被数据填满（该槽位在 SWRInfinite 里是 undefined）。
   * 为什么不看全局 isValidating：后台重取（容器在 status 事件里调 mutate()）期间 isValidating 也是 true，
   * 按它挡会把这一刻的触底追加**静默丢掉**——用户已停在底部、滚轮不再产生 scroll 事件，就再也不补页了。
   * 出错时（重试耗尽）放行，避免槽位永远空着把后续追加一起堵死（SWR 自身也会按退避重试）。
   */
  const appending = pages.length < size && error === undefined;
  const loadMore = useCallback((): void => {
    // 已到最早一条、或上一页还在路上：不再追加（手动连点与触底自动加载撞车时也只发一页）
    if (!hasMore || appending) return;
    void setSize(size + 1);
  }, [appending, hasMore, setSize, size]);
  /** 回到第一页（过滤条件变更后回到首屏窗口；SWR 会按新 key 重新取第一页） */
  const reset = useCallback((): void => {
    void setSize(1);
  }, [setSize]);
  return {
    commits,
    hasMore,
    /** 追加页请求中（首屏加载与后台重取都不算——见 appending 注释；首屏另有 isLoading） */
    loadingMore: appending,
    isLoading,
    error,
    loadMore,
    reset,
    mutate,
    /** 已加载页数（容器据此判断「是否还是首屏窗口」以决定要不要接流式合并） */
    size,
  };
}

/** 分页拉取提交历史：GET /api/repos/:repoId/log?limit&skip&author&path&range；repoId 为空挂 null key 不发请求（条件拉取） */
export function useLogPage(repoId: string, query?: Partial<LogQuery>) {
  const params = new URLSearchParams();
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.skip !== undefined) params.set('skip', String(query.skip));
  if (query?.author) params.set('author', query.author);
  if (query?.path) params.set('path', query.path);
  if (query?.range) params.set('range', query.range);
  const qs = params.toString();
  return useSWR<LogPage>(
    repoId === '' ? null : `/api/repos/${repoId}/log${qs ? `?${qs}` : ''}`,
    getJson,
  );
}

/** 订阅日志增量：SSE log.line → commits 追加；stream.error → error 暴露并断开；connected 表示订阅存活，卸载即中止。
 *  refreshKey 变化时重订阅（服务端状态变化后日志刷新的入口：新提交会出现在新流顶部）。 */
export function useLogStream(repoId: string, refreshKey = 0): { commits: CommitInfo[]; connected: boolean; error: string | null } {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setCommits([]);
    setError(null);
    setConnected(true);
    void subscribeSse(`/api/repos/${repoId}/log/stream`, (event) => {
      if (event.type === 'log.line') setCommits((prev) => [...prev, event.payload as CommitInfo]);
      if (event.type === 'stream.error') {
        // 服务端流内错误帧（git 执行失败等）：暴露错误消息并主动断开（服务端发帧后即关闭流）
        setError((event.payload as { message: string }).message);
        setConnected(false);
        ac.abort();
      }
    }, ac.signal).catch(() => {
      // 非主动取消的断流：标记断开（重连策略由上层决定）
      if (!ac.signal.aborted) setConnected(false);
    });
    return () => {
      ac.abort();
      setConnected(false);
    };
  }, [repoId, refreshKey]);
  return { commits, connected, error };
}
