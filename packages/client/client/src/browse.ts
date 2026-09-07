/** browse hooks：历史快照浏览 —— 指定版本文件树 + 单文件内容（SWR 只读；rev/file 为空串时挂 null key 不发请求） */
import useSWR, { type SWRResponse } from 'swr';
import type { BrowseContent, BrowseTree } from '@rebased/contracts';
import { getJson } from './http';

/** 拉取指定版本文件树：GET /api/repos/:repoId/browse?rev（rev 为空串时条件拉取——页面可无条件挂载） */
export function useBrowseTree(repoId: string, rev: string): SWRResponse<BrowseTree> {
  const params = new URLSearchParams({ rev });
  return useSWR<BrowseTree>(rev === '' ? null : `/api/repos/${repoId}/browse?${params.toString()}`, getJson);
}

/** 拉取指定版本单文件内容：GET /api/repos/:repoId/browse/content?rev&file（rev 或 file 为空串时条件拉取） */
export function useBrowseContent(repoId: string, rev: string, file: string): SWRResponse<BrowseContent> {
  const params = new URLSearchParams({ rev, file });
  return useSWR<BrowseContent>(
    rev === '' || file === '' ? null : `/api/repos/${repoId}/browse/content?${params.toString()}`,
    getJson,
  );
}
