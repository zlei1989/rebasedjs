/** log 功能：分页查询与流式事件。core 提交 → contracts CommitInfo 映射在此完成。 */
import { streamLog, type CoreCommit } from '@rebased/core';
import type { CommitInfo, LogEvent, LogPage, LogQuery } from '@rebased/contracts';

function toCommitInfo(c: CoreCommit): CommitInfo {
  return {
    hash: c.hash,
    shortHash: c.shortHash,
    parents: c.parents,
    author: c.author,
    authorEmail: c.authorEmail,
    dateIso: c.dateIso,
    refs: c.refs,
    message: c.message,
    graph: c.graph,
  };
}

export async function getLogPage(repoPath: string, query: LogQuery, opts: { signal?: AbortSignal } = {}): Promise<LogPage> {
  const commits: CommitInfo[] = [];
  for await (const c of streamLog(repoPath, { skip: query.skip, maxCount: query.limit, author: query.author, path: query.path, range: query.range, signal: opts.signal })) {
    commits.push(toCommitInfo(c));
  }
  return { commits, hasMore: commits.length === query.limit };
}

export async function* streamLogEvents(repoPath: string, query: LogQuery, opts: { signal?: AbortSignal } = {}): AsyncIterable<LogEvent> {
  for await (const c of streamLog(repoPath, { skip: query.skip, maxCount: query.limit, author: query.author, path: query.path, range: query.range, signal: opts.signal })) {
    yield { type: 'log.line', payload: toCommitInfo(c) };
  }
}
