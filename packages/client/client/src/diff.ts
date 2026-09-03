/** 差异 hooks：一次性 SWR + SSE 分块流（text 累积 + connected/error 状态） */
import { useEffect, useState } from 'react';
import useSWR, { type SWRResponse } from 'swr';
import type { DiffFile, FileVersions } from '@rebased/contracts';
import { getJson } from './http';
import { subscribeSse } from './events';

/** 拉取单文件两侧全文：GET /api/repos/:repoId/diff?file&staged（端点返回 FileVersions，Monaco 两侧全文） */
export function useFileDiff(repoId: string, file: string, staged = false) {
  const params = new URLSearchParams({ file, staged: String(staged) });
  return useSWR<FileVersions>(`/api/repos/${repoId}/diff?${params.toString()}`, getJson);
}

/** 单文件 unified 补丁全文：GET /api/repos/:repoId/diff/patch?file&staged（StatusPage 行内预览、hunk 索引顺序即此全文顺序）；
 *  file 为空串时挂 null key 不发请求（条件拉取），页面可无条件挂载 */
export function useDiffPatch(repoId: string, file: string, staged: boolean): SWRResponse<DiffFile> {
  const params = new URLSearchParams({ file, staged: String(staged) });
  return useSWR<DiffFile>(file === '' ? null : `/api/repos/${repoId}/diff/patch?${params.toString()}`, getJson);
}

/** 订阅 diff 分块：SSE diff.chunk → text 累积拼接；stream.error → error 暴露并断开；connected 表示订阅存活，卸载即中止 */
export function useDiffStream(repoId: string, file: string): { text: string; connected: boolean; error: string | null } {
  const [text, setText] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setText('');
    setError(null);
    setConnected(true);
    const url = `/api/repos/${repoId}/diff/stream?file=${encodeURIComponent(file)}`;
    void subscribeSse(url, (event) => {
      if (event.type === 'diff.chunk') setText((prev) => prev + (event.payload as { text: string }).text);
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
  }, [repoId, file]);
  return { text, connected, error };
}
