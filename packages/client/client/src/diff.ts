/** 差异 hooks：一次性 SWR + SSE 分块流（text 累积 + connected 状态） */
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type { DiffFile } from '@rebased/contracts';
import { getJson } from './http';
import { subscribeSse } from './events';

/** 拉取单文件 diff：GET /api/repos/:repoId/diff?file&staged */
export function useFileDiff(repoId: string, file: string, staged = false) {
  const params = new URLSearchParams({ file, staged: String(staged) });
  return useSWR<DiffFile>(`/api/repos/${repoId}/diff?${params.toString()}`, getJson);
}

/** 订阅 diff 分块：SSE diff.chunk → text 累积拼接；connected 表示订阅存活，卸载即中止 */
export function useDiffStream(repoId: string, file: string): { text: string; connected: boolean } {
  const [text, setText] = useState('');
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    setText('');
    setConnected(true);
    const url = `/api/repos/${repoId}/diff/stream?file=${encodeURIComponent(file)}`;
    void subscribeSse(url, (event) => {
      if (event.type === 'diff.chunk') setText((prev) => prev + (event.payload as { text: string }).text);
    }, ac.signal).catch(() => {
      // 非主动取消的断流：标记断开（重连策略由上层决定）
      if (!ac.signal.aborted) setConnected(false);
    });
    return () => {
      ac.abort();
      setConnected(false);
    };
  }, [repoId, file]);
  return { text, connected };
}
