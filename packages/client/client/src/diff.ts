/** 差异 hooks：一次性 SWR + SSE 分块流（text 累积 + connected/error 状态）+ 分支 vs 工作树清单 */
import { useEffect, useRef, useState } from 'react';
import useSWR, { type SWRResponse } from 'swr';
import type { BranchWorkingDiff, DiffFile, FileThreeVersions, FileVersions } from '@rebased/contracts';
import { getJson } from './http';
import { subscribeSse } from './events';

/** 拉取单文件两侧全文：GET /api/repos/:repoId/diff?file&staged&from&to（端点返回 FileVersions，Monaco 两侧全文）；
 *  from/to 可选成对传——定提交对比（如 committed 浏览器打开某提交的变更：from=<hash>~1、to=<hash>）；
 *  file 为空串时挂 null key 不发请求（条件拉取，与 useDiffPatch/useFileThreeWay 同口径）——
 *  日志页的变更集 diff 标签常驻挂载本 hook，「当前没有要看差异的文件」是它的常态，
 *  不设这道守卫就会发出一串 `file=` 的空请求（端点必然报错）。 */
export function useFileDiff(repoId: string, file: string, staged = false, from?: string, to?: string) {
  const params = new URLSearchParams({ file, staged: String(staged) });
  if (from !== undefined) params.set('from', from);
  if (to !== undefined) params.set('to', to);
  return useSWR<FileVersions>(file === '' ? null : `/api/repos/${repoId}/diff?${params.toString()}`, getJson);
}

/** 差异 main 渲染数据：一次对比的全文 + 它属于哪个文件路径（两者成对，翻文件时同批更换） */
export interface HeldFileDiff {
  file: string;
  versions: FileVersions;
}

/**
 * useFileDiff + 「新键取数期间保留上一份」：全文未到时返回上一次已就绪的一对 {file, versions}。
 * 做什么：让差异页在翻文件 / 切 staged 的取数窗口里继续渲染同一个 DiffPage——**不把 Monaco 编辑器卸载再重建**。
 * 为什么：Monaco 在「编辑器销毁后很快重建」时会抛 `AbstractContextKeyService has been disposed`
 * （上游缺陷 microsoft/monaco-editor#4581；同族的还有 diff worker 的 `Canceled`），实测翻文件每次必现。
 * 为什么连 file 一起返回：文件名与内容同批换，取数窗口里不会出现「新文件名配旧文件内容」；换仓库同理
 * （held 记了自己属于哪个 repoId，换仓库不顶上一份）。
 * 首次进入没有上一份可顶时 data 为 undefined，页面照旧交给流式分块视图。
 */
export function useHeldFileDiff(repoId: string, file: string, staged = false, from?: string, to?: string) {
  const { data, error, isLoading } = useFileDiff(repoId, file, staged, from, to);
  // 最近一次已就绪的一对（effect 里落账：本轮渲染用到的仍是上一轮的值，正是「取数窗口里顶上」的来源）
  const lastReady = useRef<{ repoId: string; file: string; versions: FileVersions } | undefined>(undefined);
  useEffect(() => {
    if (data !== undefined) lastReady.current = { repoId, file, versions: data };
  }, [repoId, file, data]);
  if (data !== undefined) return { data: { file, versions: data }, error, isLoading };
  const held = lastReady.current;
  return {
    data: held !== undefined && held.repoId === repoId ? { file: held.file, versions: held.versions } : undefined,
    error,
    isLoading,
  };
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
