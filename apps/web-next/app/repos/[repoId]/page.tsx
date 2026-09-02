'use client';

/**
 * 日志页容器：useLogPage（分页）+ useLogStream（SSE 增量）+ useRepoStatus + useRepoEvents（状态推送）
 * 注入 ui LogPage；分页结果与流式增量拼接为 commits。
 */
import { useLogPage, useLogStream, useRecentRepos, useRepoEvents, useRepoStatus } from '@rebased/client';
import type { CommitInfo } from '@rebased/contracts';
import { LogPage } from '@rebased/ui';
import { use, useMemo, useState } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const { data: page } = useLogPage(repoId);
  const { commits: streamCommits } = useLogStream(repoId);
  const { data: status, mutate } = useRepoStatus(repoId);
  // SSE 推送的 RepoStatus 直接回写 SWR 缓存（不再触发 GET）
  useRepoEvents(repoId, (next) => void mutate(next, { revalidate: false }));
  const { data: repos } = useRecentRepos();
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const commits = useMemo(() => [...(page?.commits ?? []), ...streamCommits], [page, streamCommits]);
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
