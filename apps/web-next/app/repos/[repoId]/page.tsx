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
  useReset,
  useUndoCommit,
} from '@rebased/client';
import type { CommitInfo, ResetBody } from '@rebased/contracts';
import { LogPage, ResetDialog } from '@rebased/ui';
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
  const { trigger: resetTrigger, isMutating: resetting } = useReset(repoId);
  const { trigger: undoCommit, isMutating: undoCommitting } = useUndoCommit(repoId);
  // ResetDialog 目标提交（hash + 展示用 label）；null 表示关闭
  const [resetTarget, setResetTarget] = useState<{ hash: string; label: string } | null>(null);
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
  // 「Reset 到此处」：从 commits 找目标提交生成展示 label（短哈希 + 主题），打开 ResetDialog
  const onResetHere = (hash: string): void => {
    const commit = commits.find((c) => c.hash === hash);
    setResetTarget({ hash, label: commit ? `${commit.shortHash} ${commit.message}` : hash });
  };
  // ResetDialog 确定：触发 reset 突变（响应已回写 status 缓存，events 推送驱动 log 刷新），成功关窗提示
  const onResetOk = (body: ResetBody): void => {
    resetTrigger(body)
      .then(() => {
        setResetTarget(null);
        void message.success('已重置');
      })
      .catch((err: unknown) => void message.error(err instanceof Error ? err.message : String(err)));
  };
  // 撤销最近提交（Popconfirm 在 LogPage 内确认后回调）：成功提示，失败以服务端中文 message 提示
  const onUndoCommit = (): void => {
    undoCommit()
      .then(() => void message.success('已撤销最近提交'))
      .catch((err: unknown) => void message.error(err instanceof Error ? err.message : String(err)));
  };
  // 状态未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!status) return null;
  return (
    <>
      <LogPage
        repoName={repos?.find((r) => r.id === repoId)?.name ?? repoId}
        status={status}
        commits={commits}
        onSelectCommit={setSelectedHash}
        selectedCommit={selectedCommit}
        operation={operation}
        // 中止失败以服务端中文 message 提示（成功响应已由 useAbortOperation 回写缓存）
        onAbortOperation={() => {
          abortOperation().catch((err: unknown) =>
            void message.error(err instanceof Error ? err.message : String(err)),
          );
        }}
        abortingOperation={abortingOperation}
        onUndoCommit={onUndoCommit}
        undoCommitting={undoCommitting}
        onResetHere={onResetHere}
        onOpenSettings={() => router.push(`/repos/${repoId}/settings`)}
        onOpenStatus={() => router.push(`/repos/${repoId}/status`)}
        onOpenBranches={() => router.push(`/repos/${repoId}/branches`)}
      />
      <ResetDialog
        open={resetTarget !== null}
        ref={resetTarget?.hash ?? ''}
        refLabel={resetTarget?.label}
        confirming={resetting}
        onOk={onResetOk}
        onCancel={() => setResetTarget(null)}
      />
    </>
  );
}
