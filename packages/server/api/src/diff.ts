/** diff 功能：单文件全文与流式事件，core 原语 → contracts 形状，入参在此校验。 */
import { collectFileDiff, streamFileDiff } from '@rebased/core';
import { ServiceError, type DiffEvent, type DiffFile, type DiffQuery } from '@rebased/contracts';

/**
 * 校验 diff 查询入参，非法即抛 INVALID_QUERY。
 * 规则：from/to 必须成对提供（XOR）；staged 与 from/to 互斥，否则 core 会静默降级为工作区 diff。
 */
function assertValidQuery(query: DiffQuery): void {
  const hasFrom = query.from !== undefined;
  const hasTo = query.to !== undefined;
  if (hasFrom !== hasTo) throw new ServiceError('INVALID_QUERY', 'diff 查询必须同时提供 from 与 to，或同时缺省');
  if (query.staged && (hasFrom || hasTo)) throw new ServiceError('INVALID_QUERY', 'staged 与 from/to 不能同时使用');
}

export async function getFileDiff(repoPath: string, query: DiffQuery): Promise<DiffFile> {
  assertValidQuery(query);
  const text = await collectFileDiff(repoPath, query);
  return { path: query.file, text };
}

export async function* streamDiffEvents(repoPath: string, query: DiffQuery): AsyncIterable<DiffEvent> {
  assertValidQuery(query);
  for await (const chunk of streamFileDiff(repoPath, query)) {
    yield { type: 'diff.chunk', payload: { text: chunk } };
  }
}
