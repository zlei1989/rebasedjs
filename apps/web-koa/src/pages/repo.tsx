/**
 * 日志页容器：useLogPage（分页快照）+ useLogStream（SSE 渐进式渲染）+ useRepoStatus + useRepoEvents（状态推送）
 * 注入 ui LogPage（与 web-next 容器同构；repoId 取 useParams 而非 Next params）。
 * 流式语义（Ruling 6）：stream 是同一查询的渐进式渲染而非快照后的新增，
 * 故 commits 经 mergeLogCommits 合成——流连接中以流为主列表，REST 快照作首屏与 hash 去重兜底。
 */
import { useLogPage, useLogStream, useRecentRepos, useRepoEvents, useRepoStatus } from '@rebased/client';
import type { CommitInfo } from '@rebased/contracts';
import { LogPage } from '@rebased/ui';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { mergeLogCommits } from '../log-merge';

export function RepoPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const { data: page } = useLogPage(repoId);
  const { commits: streamCommits, connected: streamConnected } = useLogStream(repoId);
  const { data: status, mutate } = useRepoStatus(repoId);
  // SSE 推送的 RepoStatus 直接回写 SWR 缓存（不再触发 GET）
  useRepoEvents(repoId, (next) => void mutate(next, { revalidate: false }));
  const { data: repos } = useRecentRepos();
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
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
