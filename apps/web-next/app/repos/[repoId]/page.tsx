'use client';

/**
 * 日志页容器：useLogPage（分页快照）+ useLogStream（SSE 渐进式渲染）+ useRepoStatus + useRepoEvents（状态推送）
 * 注入 ui LogPage。流式语义（Ruling 6）：stream 是同一查询的渐进式渲染而非快照后的新增，
 * 故 commits 经 mergeLogCommits 合成——流连接中以流为主列表，REST 快照作首屏与 hash 去重兜底。
 * 远程操作区：顶栏「更多」入口（变基/标签/拉取/推送/更新项目/远程管理/补丁/搁置/控制台/忽略）+ pull/push/update 对话框（页面化 Modal 不如对话框内联——Java 版即为对话框）。
 * 变基区：RebaseDialog 双模式状态机——简单模式 → useRebase；交互模式 → base 本地状态驱动
 * useRebaseTodo 重取（onBaseChange）+ useInteractiveRebase 提交；结果 success → 提示关闭（events 推送刷新日志）；
 * conflicts → 警告 + 跳冲突页（操作态经 events 推送，conflicts 页自行加载）。
 * 摘樱桃/还原区：CommitDetailsPanel 回调 → 容器 Modal.confirm 确认 → useCherryPick/useRevert；
 * 结果 conflicts → 警告 + 跳冲突页。
 * AuthDialog 全局于本容器（认证重试回路范式，后续页面需要认证的远程操作复用此装配）：
 * 操作失败 err instanceof ServiceError 且 code==='AUTH_FAILED' → 开 AuthDialog（host 自 err.context）
 * → onOk = upsertAccount({host, account, token}) → 成功后重试原操作一次；取消即放弃。
 */
import {
  useAbortOperation,
  useCherryPick,
  useGithubStatus,
  useGitlabStatus,
  useInteractiveRebase,
  useLogPage,
  useLogStream,
  useOperation,
  usePull,
  usePush,
  useRebase,
  useRebaseTodo,
  useRecentRepos,
  useRemotes,
  useRepoEvents,
  useRepoStatus,
  useReset,
  useRevert,
  useUndoCommit,
  useUpdateProject,
  useUpsertAccount,
} from '@rebased/client';
import {
  ServiceError,
  type CommitInfo,
  type InteractiveRebaseBody,
  type PickOutcome,
  type PullBody,
  type PushBody,
  type RebaseBody,
  type RebaseOutcome,
  type ResetBody,
  type UpdateBody,
} from '@rebased/contracts';
import { AuthDialog, LogPage, PullDialog, PushDialog, RebaseDialog, ResetDialog, UpdateProjectDialog } from '@rebased/ui';
import { Modal, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { mergeLogCommits } from '../../../src/log-merge';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ select?: string }>;
}): React.ReactNode {
  const { repoId } = use(params);
  // 深链选中：blame/history/search 页的提交行跳回本页 ?select=<hash>，初始化选中提交（加载窗口外的提交
  // 无法命中列表，详情面板不渲染——已知限制，见报告）
  const { select } = use(searchParams);
  const router = useRouter();
  const { data: page, mutate: mutateLog } = useLogPage(repoId);
  const [refreshKey, setRefreshKey] = useState(0);
  const { commits: streamCommits, connected: streamConnected, error: streamError } = useLogStream(repoId, refreshKey);
  const { data: status, mutate } = useRepoStatus(repoId);
  // GitHub 面板可用性：检测到 GitHub 远程才给 LogPage 注入入口（对齐 Java 行为）；失败静默隐藏（渐进增强）
  const { data: githubStatus } = useGithubStatus(repoId);
  // GitLab 面板可用性：与 GitHub 并排、各自检测（容器经 useGitlabStatus 判定菜单项显隐）
  const { data: gitlabStatus } = useGitlabStatus(repoId);
  const { data: operation, mutate: mutateOperation } = useOperation(repoId);
  const { trigger: abortOperation, isMutating: abortingOperation } = useAbortOperation(repoId);
  const { trigger: resetTrigger, isMutating: resetting } = useReset(repoId);
  const { trigger: undoCommit, isMutating: undoCommitting } = useUndoCommit(repoId);
  // 远程操作区：远程列表（pull/push 对话框数据源）+ pull/push/update 突变 + 账户保存（认证重试回路用）
  const { data: remotes } = useRemotes(repoId);
  const { trigger: pull, isMutating: pulling } = usePull(repoId);
  const { trigger: push, isMutating: pushing } = usePush(repoId);
  const { trigger: updateProject, isMutating: updating } = useUpdateProject(repoId);
  const { trigger: upsertAccount, isMutating: savingAccount } = useUpsertAccount();
  // 全局 mutate：onRefs 里重验证分支列表缓存键（本页未挂载 useBranches，仅对已挂载该键的页面生效，如分支页打开期间）
  const { mutate: mutateGlobal } = useSWRConfig();
  // ResetDialog 目标提交（hash + 展示用 label）；null 表示关闭
  const [resetTarget, setResetTarget] = useState<{ hash: string; label: string } | null>(null);
  // pull/push/update 对话框状态机：同一时间只开一个；null 表示全关（对话框内部选择态在关闭时自复位）
  const [openDialog, setOpenDialog] = useState<'pull' | 'push' | 'update' | null>(null);
  // 认证重试回路状态：待重试的原操作 + 认证目标 host；null 表示 AuthDialog 关闭
  const [authRetry, setAuthRetry] = useState<{ host: string; retry: () => Promise<unknown> } | null>(null);
  // 状态推送（干净提交也使 headHash 变化 → 触发此回调）：回写 status 缓存 + 重验证日志快照 + 重订阅流（新提交出现在新流顶部）；
  // 操作推送（operation.state-changed）：回写 operation 缓存驱动顶栏操作条
  useRepoEvents(repoId, {
    onStatus: (next) => {
      void mutate(next, { revalidate: false });
      void mutateLog();
      setRefreshKey((k) => k + 1);
    },
    onOperation: (next) => void mutateOperation(next, { revalidate: false }),
    // 引用推送（refs.changed：分支/标签/贮藏 建删/移动；首帧为全量基线，空数组=指纹变化但名单未知——watcher 扩展的首个消费方）：
    // 重验证日志快照（ref chips 与图形可达性变化）+ 全局重验证分支列表缓存键（本页未挂载 useBranches；
    // 全局 mutate 仅对已挂载该键的页面生效）。HEAD 切换由 repo.state-changed（onStatus）覆盖，不在此帧
    onRefs: () => {
      void mutateLog();
      void mutateGlobal(`/api/repos/${repoId}/branches`);
    },
  });
  const { data: repos } = useRecentRepos();
  // ?select= 深链初始化：首次挂载即选中目标提交（后续选中仍由 onSelectCommit 经本地 state 驱动）
  const [selectedHash, setSelectedHash] = useState<string | null>(select ?? null);
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
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection（与 reset/undo 内联 catch 并存）
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // === 变基区（RebaseDialog 双模式状态机）===
  const { trigger: rebase, isMutating: rebasing } = useRebase(repoId);
  const { trigger: interactiveRebase, isMutating: interactiveRebasing } = useInteractiveRebase(repoId);
  // 交互模式基准（'' = 未输入，useRebaseTodo 挂 null key 不发请求）；容器持有 base，UI 输入经 onBaseChange 回写
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [rebaseBase, setRebaseBase] = useState('');
  // 交互模式 todo 数据源：base 变化自动重取，old-data 期间 ui 以 todoLoading 禁用确定（Task 6 审查防御）；
  // 加载失败（无效 base 等）经 todoError 透传 UI 显式呈现，避免误导性的「无待重放提交」（P3-B 终审）
  const { data: rebaseTodo, isLoading: rebaseTodoLoading, error: rebaseTodoError } = useRebaseTodo(repoId, rebaseBase);
  // 变基结果分派：success → 提示（events 推送 headHash/refs 变化刷新日志）；conflicts → 警告 + 跳冲突页；
  // up-to-date → 提示；任何结果都关闭对话框并复位 base（失败路径同 reset/undo 先例，只提示不关窗——用户可改参重试）
  const dispatchRebaseOutcome = (outcome: RebaseOutcome): void => {
    if (outcome.status === 'conflicts') {
      void message.warning('变基存在冲突，请解决后完成');
      router.push(`/repos/${repoId}/conflicts`);
    } else if (outcome.status === 'up-to-date') {
      void message.info('已是最新');
    } else {
      void message.success('变基完成');
    }
    setRebaseBase('');
    setRebaseOpen(false);
  };
  const onRebaseOnto = (body: RebaseBody): void => {
    rebase(body).then(dispatchRebaseOutcome).catch(onError);
  };
  const onInteractiveRebase = (body: InteractiveRebaseBody): void => {
    interactiveRebase(body).then(dispatchRebaseOutcome).catch(onError);
  };
  // === 摘樱桃/还原区（CommitDetailsPanel 回调 → 容器确认 → hook）===
  const { trigger: cherryPick } = useCherryPick(repoId);
  const { trigger: revert } = useRevert(repoId);
  // pick 结果分派：success → 提示（events 推送 headHash 变化刷新日志）；conflicts → 警告 + 跳冲突页
  const dispatchPickOutcome = (outcome: PickOutcome): void => {
    if (outcome.status === 'conflicts') {
      void message.warning('存在冲突，请解决后完成');
      router.push(`/repos/${repoId}/conflicts`);
    } else {
      void message.success('操作完成');
    }
  };
  // 摘樱桃/还原：Modal.confirm 确认后调 hook（确认弹窗由容器持有，按钮提示语按操作区分）
  const onCherryPick = (hash: string): void => {
    Modal.confirm({
      title: '摘樱桃',
      content: '确认将选中提交摘到当前分支？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => cherryPick({ hashes: [hash] }).then(dispatchPickOutcome).catch(onError),
    });
  };
  const onRevert = (hash: string): void => {
    Modal.confirm({
      title: '还原',
      content: '确认反转选中提交（生成 Revert 提交）？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => revert({ hashes: [hash] }).then(dispatchPickOutcome).catch(onError),
    });
  };
  /**
   * 远程数据传输操作的公共出口（认证重试回路装配点，范式供后续页面复用）：
   * 成功 → onSuccess 呈现结果；失败且 err 为 ServiceError('AUTH_FAILED') → 关当前对话框、开 AuthDialog
   * （host 自 err.context——服务端 withAuth 抛出时携带 {host}，绝不含 token），retry 闭包持有原操作待重试；
   * 其余错误 → 服务端中文 message 提示
   */
  function runRemoteOp<T>(op: () => Promise<T>, onSuccess: (outcome: T) => void): void {
    op()
      .then(onSuccess)
      .catch((err: unknown) => {
        if (err instanceof ServiceError && err.code === 'AUTH_FAILED') {
          const host = (err.context as { host?: string } | undefined)?.host ?? '';
          setOpenDialog(null);
          setAuthRetry({ host, retry: () => op().then(onSuccess) });
        } else {
          void message.error(err instanceof Error ? err.message : String(err));
        }
      });
  }
  // PullDialog 确定：按结果呈现（成功响应已由事件推送驱动 status/log 刷新，无需手动 mutate）
  const onPullOk = (body: PullBody): void => {
    runRemoteOp(
      () => pull(body),
      (outcome) => {
        setOpenDialog(null);
        if (outcome.status === 'up-to-date') void message.info('已是最新');
        else if (outcome.status === 'updated') void message.success('拉取完成');
        else void message.warning('拉取存在冲突，请解决后完成');
      },
    );
  };
  // PushDialog 确定：rejected 为 200 业务结果（非错误），以 hint 中文引导提示
  const onPushOk = (body: PushBody): void => {
    runRemoteOp(
      () => push(body),
      (outcome) => {
        setOpenDialog(null);
        if (outcome.status === 'rejected') void message.warning(outcome.hint ?? '推送被拒绝');
        else if (outcome.status === 'up-to-date') void message.info('已是最新');
        else void message.success('推送完成');
      },
    );
  };
  // UpdateProjectDialog 确定：结果 = fetch 引用数 + pull 状态的组合视图
  const onUpdateOk = (body: UpdateBody): void => {
    runRemoteOp(
      () => updateProject(body),
      (outcome) => {
        setOpenDialog(null);
        if (outcome.pull.status === 'up-to-date') void message.info('已是最新');
        else if (outcome.pull.status === 'updated') void message.success(`更新完成（fetch 更新 ${outcome.fetched.length} 个引用）`);
        else void message.warning('更新存在冲突，请解决后完成');
      },
    );
  };
  // AuthDialog 确定（保存并重试）：先 upsertAccount 持久化凭据，成功后重试原操作一次；
  // 重试仍 AUTH_FAILED（凭据可能不对）→ 保持弹窗循环，用户可换凭据再试或取消；其余错误 → 关窗 + 提示
  const onAuthOk = (account: string, token: string): void => {
    const pending = authRetry;
    if (!pending) return;
    upsertAccount({ host: pending.host, account, token })
      .then(() => pending.retry())
      .then(() => setAuthRetry(null))
      .catch((err: unknown) => {
        if (err instanceof ServiceError && err.code === 'AUTH_FAILED') {
          void message.error(err.message);
        } else {
          setAuthRetry(null);
          void message.error(err instanceof Error ? err.message : String(err));
        }
      });
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
        onOpenMerge={() => router.push(`/repos/${repoId}/merge`)}
        onOpenStashes={() => router.push(`/repos/${repoId}/stashes`)}
        onOpenConflicts={() => router.push(`/repos/${repoId}/conflicts`)}
        onOpenRebase={() => setRebaseOpen(true)}
        onOpenTags={() => router.push(`/repos/${repoId}/tags`)}
        onOpenBlame={() => router.push(`/repos/${repoId}/blame`)}
        onOpenHistory={() => router.push(`/repos/${repoId}/history`)}
        onOpenCommitted={() => router.push(`/repos/${repoId}/committed`)}
        onOpenSearch={() => router.push(`/repos/${repoId}/search`)}
        onOpenPatches={() => router.push(`/repos/${repoId}/patches`)}
        onOpenShelves={() => router.push(`/repos/${repoId}/shelves`)}
        onOpenConsole={() => router.push(`/repos/${repoId}/console`)}
        onOpenIgnore={() => router.push(`/repos/${repoId}/ignore`)}
        onOpenGithub={() => router.push(`/repos/${repoId}/github`)}
        githubAvailable={githubStatus?.detected === true}
        onOpenGitlab={() => router.push(`/repos/${repoId}/gitlab`)}
        gitlabAvailable={gitlabStatus?.detected === true}
        onCherryPick={onCherryPick}
        onRevert={onRevert}
        onOpenPull={() => setOpenDialog('pull')}
        onOpenPush={() => setOpenDialog('push')}
        onOpenUpdate={() => setOpenDialog('update')}
        onOpenRemotes={() => router.push(`/repos/${repoId}/remotes`)}
      />
      {/* 变基对话框：双模式状态机（简单 → useRebase；交互 → base 驱动 todo 重取 + useInteractiveRebase 提交）；
          取消即复位（RebaseDialog 内部状态自行复位，base 归空使 useRebaseTodo 挂 null key 停止重取） */}
      <RebaseDialog
        open={rebaseOpen}
        base={rebaseBase}
        todo={rebaseTodo}
        todoLoading={rebaseTodoLoading}
        todoError={rebaseTodoError?.message}
        confirming={rebasing || interactiveRebasing}
        onBaseChange={setRebaseBase}
        onRebaseOnto={onRebaseOnto}
        onInteractiveRebase={onInteractiveRebase}
        onCancel={() => {
          setRebaseBase('');
          setRebaseOpen(false);
        }}
      />
      <ResetDialog
        open={resetTarget !== null}
        ref={resetTarget?.hash ?? ''}
        refLabel={resetTarget?.label}
        confirming={resetting}
        onOk={onResetOk}
        onCancel={() => setResetTarget(null)}
      />
      {/* 远程列表未就绪时以空列表兜底（对话框内远程 Select 不预选，用户可待加载后重开） */}
      <PullDialog
        open={openDialog === 'pull'}
        remotes={remotes ?? { remotes: [] }}
        confirming={pulling}
        onOk={onPullOk}
        onCancel={() => setOpenDialog(null)}
      />
      <PushDialog
        open={openDialog === 'push'}
        remotes={remotes ?? { remotes: [] }}
        currentBranch={status.branch}
        confirming={pushing}
        onOk={onPushOk}
        onCancel={() => setOpenDialog(null)}
      />
      <UpdateProjectDialog
        open={openDialog === 'update'}
        confirming={updating}
        onOk={onUpdateOk}
        onCancel={() => setOpenDialog(null)}
      />
      {/* 认证重试回路出口：host 只读展示；取消即放弃原操作。confirming 覆盖保存与重试全程 */}
      <AuthDialog
        open={authRetry !== null}
        host={authRetry?.host ?? ''}
        confirming={savingAccount || pulling || pushing || updating}
        onOk={onAuthOk}
        onCancel={() => setAuthRetry(null)}
      />
    </>
  );
}
