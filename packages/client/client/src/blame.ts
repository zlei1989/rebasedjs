/** 溯源 hooks：单文件逐行责任归属（git blame --line-porcelain；SWR 只读，不持业务逻辑；rev 可选指定版本——Annotate Revision） */
import useSWR, { type SWRResponse } from 'swr';
import type { BlameLine } from '@rebased/contracts';
import { getJson } from './http';

/** 拉取单文件溯源行：GET /api/repos/:repoId/blame?file[&rev]（file 为空串时挂 null key 不发请求——条件拉取，页面可无条件挂载） */
export function useBlame(repoId: string, file: string, rev?: string): SWRResponse<BlameLine[]> {
  const params = new URLSearchParams({ file });
  if (rev !== undefined && rev !== '') params.set('rev', rev);
  return useSWR<BlameLine[]>(file === '' ? null : `/api/repos/${repoId}/blame?${params.toString()}`, getJson);
}
