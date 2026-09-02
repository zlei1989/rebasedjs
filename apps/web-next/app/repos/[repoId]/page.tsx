'use client';

/**
 * 日志页容器：useLogPage（分页快照）+ useLogStream（SSE 渐进式渲染）+ useRepoStatus + useRepoEvents（状态推送）
 * 注入 ui LogPage。流式语义（Ruling 6）：stream 是同一查询的渐进式渲染而非快照后的新增，
 * 故 commits 经 mergeLogCommits 合成——流连接中以流为主列表，REST 快照作首屏与 hash 去重兜底。
 */
import { useLogPage, useLogStream, useRecentRepos, useRepoEvents, useRepoStatus } from '@rebased/client';
import type { CommitInfo } from '@rebased/contracts';
import { LogPage } from '@rebased/ui';
import { message } from 'antd';
import { use, useEffect, useMemo, useState } from 'react';
import { mergeLogCommits } from '../../../src/log-merge';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const { data: page } = useLogPage(repoId);
  const { commits: streamCommits, connected: streamConnected, error: streamError } = useLogStream(repoId);
  const { data: status, mutate } = useRepoStatus(repoId);
  // SSE 推送的 RepoStatus 直接回写 SWR 缓存（不再触发 GET）
  useRepoEvents(repoId, (next) => void mutate(next, { revalidate: false }));
  const { data: repos } = useRecentRepos();
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  // stream.error 一次性呈现（Task 7 终审 deferred 接通）：error 置位即断开订阅，effect 仅触发一次
  useEffect(() => {
    if (streamError) void message.error(streamError);
  }, [streamError]);
  const commits = useMemo(
    () => mergeLogCommits(page?.commits ?? [], streamCommits, streamConnected),
    [page, streamCommits, streamConnected],
  );
  const selectedCommit: CommitInfo | null = commits.find((c) => c.hash === selectedHash) ?? null;
  // 状态未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!status) return null;
  return (
    <LogPage
      repoName={repos?.find((r) => r.id === repoId)?.name ?? repoId}
      status={status}
      commits={commits}
      onSelectCommit={setSelectedHash}
      selectedCommit={selectedCommit}
    />
  );
}
