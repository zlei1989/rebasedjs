'use client';

/**
 * 日志页容器：useLogPage（分页快照）+ useLogStream（SSE 渐进式渲染）+ useRepoStatus + useRepoEvents（状态推送）
 * 注入 ui LogPage。流式语义（Ruling 6）：stream 是同一查询的渐进式渲染而非快照后的新增，
 * 故 commits 经 mergeLogCommits 合成——流连接中以流为主列表，REST 快照作首屏与 hash 去重兜底。
 */
import {
  useAbortOperation,
  useLogPage,
  useLogStream,
  useOperation,
  useRecentRepos,
  useRepoEvents,
  useRepoStatus,
} from '@rebased/client';
import type { CommitInfo } from '@rebased/contracts';
import { LogPage } from '@rebased/ui';
import { message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import { mergeLogCommits } from '../../../src/log-merge';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: page, mutate: mutateLog } = useLogPage(repoId);
  const [refreshKey, setRefreshKey] = useState(0);
  const { commits: streamCommits, connected: streamConnected, error: streamError } = useLogStream(repoId, refreshKey);
  const { data: status, mutate } = useRepoStatus(repoId);
  const { data: operation, mutate: mutateOperation } = useOperation(repoId);
  const { trigger: abortOperation, isMutating: abortingOperation } = useAbortOperation(repoId);
  // 状态推送（干净提交也使 headHash 变化 → 触发此回调）：回写 status 缓存 + 重验证日志快照 + 重订阅流（新提交出现在新流顶部）；
  // 操作推送（operation.state-changed）：回写 operation 缓存驱动顶栏操作条
  useRepoEvents(repoId, {
    onStatus: (next) => {
      void mutate(next, { revalidate: false });
      void mutateLog();
      setRefreshKey((k) => k + 1);
    },
    onOperation: (next) => void mutateOperation(next, { revalidate: false }),
  });
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
      operation={operation}
      // 中止失败以服务端中文 message 提示（成功响应已由 useAbortOperation 回写缓存）
      onAbortOperation={() => {
        abortOperation().catch((err: unknown) => void message.error(err instanceof Error ? err.message : String(err)));
      }}
      abortingOperation={abortingOperation}
      onOpenSettings={() => router.push(`/repos/${repoId}/settings`)}
    />
  );
}
