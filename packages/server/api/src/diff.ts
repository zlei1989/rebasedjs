/** diff 功能：单文件全文与流式事件，core 原语 → contracts 形状，入参在此校验。 */
import { isAbsolute } from 'node:path';
import { collectFileDiff, readFileAtRev, streamFileDiff } from '@rebased/core';
import { ServiceError, type DiffEvent, type DiffFile, type DiffQuery, type FileVersions } from '@rebased/contracts';

/**
 * 校验 diff 查询入参，非法即抛 INVALID_QUERY。
 * 规则：from/to 必须成对提供（XOR）；staged 与 from/to 互斥，否则 core 会静默降级为工作区 diff。
 * 安全：file 必须为仓库内相对路径。工作区分支经 join(repoPath, file) 直读文件系统，
 * 含 `..` 路径段或绝对路径的 file 可逃逸仓库根读取任意文件（rev 分支因 git 拒绝 `..` 免疫），
 * 故在此统一拦截。
 */
function assertValidQuery(query: DiffQuery): void {
  const hasFrom = query.from !== undefined;
  const hasTo = query.to !== undefined;
  if (hasFrom !== hasTo) throw new ServiceError('INVALID_QUERY', 'diff 查询必须同时提供 from 与 to，或同时缺省');
  if (query.staged && (hasFrom || hasTo)) throw new ServiceError('INVALID_QUERY', 'staged 与 from/to 不能同时使用');
  if (query.file.split(/[\\/]/).includes('..') || isAbsolute(query.file)) {
    throw new ServiceError('INVALID_QUERY', 'diff 查询 file 必须是仓库内相对路径');
  }
}

export async function getFileDiff(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): Promise<DiffFile> {
  assertValidQuery(query);
  const text = await collectFileDiff(repoPath, { ...query, signal: opts.signal });
  return { path: query.file, text };
}

export async function* streamDiffEvents(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): AsyncIterable<DiffEvent> {
  assertValidQuery(query);
  for await (const chunk of streamFileDiff(repoPath, { ...query, signal: opts.signal })) {
    yield { type: 'diff.chunk', payload: { text: chunk } };
  }
}

/** 单文件两侧全文：staged→HEAD vs 暂存区；工作区→HEAD vs 工作区；from/to→两侧版本。 */
export async function getFileVersions(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): Promise<FileVersions> {
  assertValidQuery(query);
  if (query.from !== undefined && query.to !== undefined) {
    const [before, after] = await Promise.all([
      readFileAtRev(repoPath, { file: query.file, rev: query.from }),
      readFileAtRev(repoPath, { file: query.file, rev: query.to }),
    ]);
    return { before, after };
  }
  const before = await readFileAtRev(repoPath, { file: query.file, rev: 'HEAD' });
  const after = query.staged
    ? await readFileAtRev(repoPath, { file: query.file, rev: '' })
    : await readFileAtRev(repoPath, { file: query.file });
  return { before, after };
}
