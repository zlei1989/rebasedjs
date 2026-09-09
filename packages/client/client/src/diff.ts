/** 差异 hooks：一次性 SWR + SSE 分块流（text 累积 + connected/error 状态）+ 分支 vs 工作树清单 */
import { useEffect, useState } from 'react';
import useSWR, { type SWRResponse } from 'swr';
import type { BranchWorkingDiff, DiffFile, FileThreeVersions, FileVersions } from '@rebased/contracts';
import { getJson } from './http';
import { subscribeSse } from './events';

/** 拉取单文件两侧全文：GET /api/repos/:repoId/diff?file&staged&from&to（端点返回 FileVersions，Monaco 两侧全文）；
 *  from/to 可选成对传——定提交对比（如 committed 浏览器打开某提交的变更：from=<hash>~1、to=<hash>） */
export function useFileDiff(repoId: string, file: string, staged = false, from?: string, to?: string) {
  const params = new URLSearchParams({ file, staged: String(staged) });
  if (from !== undefined) params.set('from', from);
  if (to !== undefined) params.set('to', to);
  return useSWR<FileVersions>(`/api/repos/${repoId}/diff?${params.toString()}`, getJson);
}

/** 单文件 unified 补丁全文：GET /api/repos/:repoId/diff/patch?file&staged（StatusPage 行内预览、hunk 索引顺序即此全文顺序）；
 *  file 为空串时挂 null key 不发请求（条件拉取），页面可无条件挂载 */
export function useDiffPatch(repoId: string, file: string, staged: boolean): SWRResponse<DiffFile> {
  const params = new URLSearchParams({ file, staged: String(staged) });
  return useSWR<DiffFile>(file === '' ? null : `/api/repos/${repoId}/diff/patch?${params.toString()}`, getJson);
}

/** 三版本对比：GET /api/repos/:repoId/diff/three-way?file（HEAD/暂存/工作区三侧全文；file 为空串挂 null key 不发请求） */
export function useFileThreeWay(repoId: string, file: string): SWRResponse<FileThreeVersions> {
  const params = new URLSearchParams({ file });
  return useSWR<FileThreeVersions>(file === '' ? null : `/api/repos/${repoId}/diff/three-way?${params.toString()}`, getJson);
}

/** 分支 vs 工作树差异（GitShowDiffWithRefAction 语义）：GET /api/repos/:repoId/diff/branch-working?branch=；
 *  branch 为空串时挂 null key 不发请求（条件拉取，页面可无条件挂载） */
export function useBranchWorkingDiff(repoId: string, branch: string): SWRResponse<BranchWorkingDiff> {
  const params = new URLSearchParams({ branch });
  return useSWR<BranchWorkingDiff>(branch === '' ? null : `/api/repos/${repoId}/diff/branch-working?${params.toString()}`, getJson);
}

/** 订阅 diff 分块：SSE diff.chunk → text 累积拼接；stream.error → error 暴露并断开；connected 表示订阅存活，卸载即中止。
 *  staged/from/to 与 useFileDiff 同口径（分块流与全文查询必须同参：流视图是同一查询的渐进渲染，Ruling 6）。 */
export function useDiffStream(
  repoId: string,
  file: string,
  staged = false,
  from?: string,
  to?: string,
): { text: string; connected: boolean; error: string | null } {
  const [text, setText] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setText('');
    setError(null);
    setConnected(true);
    const params = new URLSearchParams({ file, staged: String(staged) });
    if (from !== undefined) params.set('from', from);
    if (to !== undefined) params.set('to', to);
    const url = `/api/repos/${repoId}/diff/stream?${params.toString()}`;
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
  }, [repoId, file, staged, from, to]);
  return { text, connected, error };
}
