/** 日志 hooks：分页 SWR + SSE 增量流（commits 增量追加 + connected/error 状态） */
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type { CommitInfo, LogPage, LogQuery } from '@rebased/contracts';
import { getJson } from './http';
import { subscribeSse } from './events';

/** 分页拉取提交历史：GET /api/repos/:repoId/log?limit&skip&author&path */
export function useLogPage(repoId: string, query?: Partial<LogQuery>) {
  const params = new URLSearchParams();
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.skip !== undefined) params.set('skip', String(query.skip));
  if (query?.author) params.set('author', query.author);
  if (query?.path) params.set('path', query.path);
  const qs = params.toString();
  return useSWR<LogPage>(`/api/repos/${repoId}/log${qs ? `?${qs}` : ''}`, getJson);
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
