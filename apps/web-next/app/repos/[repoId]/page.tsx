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
  useBranchAction,
  useCherryPick,
  useCheckout,
  useGithubStatus,
  useGitlabStatus,
  useInteractiveRebase,
  useAutosquash,
  useCommitEdit,
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
  useTagAction,
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
import { AuthDialog, BranchCompareView, LogPage, PullDialog, PushDialog, RebaseDialog, ResetDialog, UpdateProjectDialog } from '@rebased/ui';
import { Modal, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { mergeLogCommits } from '../../../src/log-merge';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ select?: string; compare?: string }>;
}): React.ReactNode {
  const { repoId } = use(params);
  // 深链选中：blame/history/search 页的提交行跳回本页 ?select=<hash>，初始化选中提交（加载窗口外的提交
  // 无法命中列表，详情面板不渲染——已知限制，见报告）
  const { select, compare } = use(searchParams);
  const router = useRouter();
  // 过滤/分页（P2 收取）：author/path 过滤（文本即滤，对齐 Java）；limit 阶梯放大（50→500 上限）实现「加载更多」。
  // 过滤或翻页会改变查询语义——此时流（Ruling 6 同查询渐进渲染）与快照不再同查询，故仅默认视图（无过滤且 limit=50）接入流合并
  const [author, setAuthor] = useState('');
  const [path, setPath] = useState('');
  const [limit, setLimit] = useState(50);
  const streamEnabled = author === '' && path === '' && limit === 50;
  const { data: page, mutate: mutateLog, isLoading: logLoading } = useLogPage(repoId, {
    ...(author === '' ? {} : { author }),
    ...(path === '' ? {} : { path }),
    limit,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const { commits: streamCommits, connected: streamConnected, error: streamError } = useLogStream(repoId, refreshKey);
  const { data: status, mutate } = useRepoStatus(repoId);
  // 分支对比视图（?compare=<branch>，GitCompareWithBranchAction 语义）：双 range 查询
  // current..branch（分支独有）与 branch..current（当前独有）；status readiness 由下方守卫保证。
  const compareBranch = compare === undefined || compare === '' ? null : compare;
  const compareRangeA = compareBranch !== null ? `${status?.branch ?? 'HEAD'}..${compareBranch}` : null;
  const compareRangeB = compareBranch !== null ? `${compareBranch}..${status?.branch ?? 'HEAD'}` : null;
  const { data: compareA } = useLogPage(compareRangeA === null ? '' : repoId, {
    ...(compareRangeA === null ? {} : { range: compareRangeA }),
    limit: 500,
  });
  const { data: compareB } = useLogPage(compareRangeB === null ? '' : repoId, {
    ...(compareRangeB === null ? {} : { range: compareRangeB }),
    limit: 500,
  });
  // GitHub 面板可用性：检测到 GitHub 远程才给 LogPage 注入入口（对齐 Java 行为）；失败静默隐藏（渐进增强）
  const { data: githubStatus } = useGithubStatus(repoId);
  // GitLab 面板可用性：与 GitHub 并排、各自检测（容器经 useGitlabStatus 判定菜单项显隐）
  const { data: gitlabStatus } = useGitlabStatus(repoId);
  const { data: operation, mutate: mutateOperation } = useOperation(repoId);
  const { trigger: abortOperation, isMutating: abortingOperation } = useAbortOperation(repoId);
  const { trigger: resetTrigger, isMutating: resetting } = useReset(repoId);
  const { trigger: undoCommit, isMutating: undoCommitting } = useUndoCommit(repoId);
  // 行右键菜单（Java Vcs.Log.ContextMenu 组）：检出/新建分支/新建标签 mutation + 浏览器打开链接（GitHub/GitLab 提交页）
  const { trigger: checkout, isMutating: checkingOut } = useCheckout(repoId);
  const { trigger: branchAction } = useBranchAction(repoId);
  const { trigger: tagAction, isMutating: tagActing } = useTagAction(repoId);
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
  // Push up to Commit（#17）：行右键「Push up to Commit」→ 打开 PushDialog 并预置目标提交 hash；null=普通推送
  const [pushUpToHash, setPushUpToHash] = useState<string | null>(null);
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
    () =>
      streamEnabled
        ? mergeLogCommits(page?.commits ?? [], streamCommits, streamConnected)
        : page?.commits ?? [],
    [page, streamCommits, streamConnected, streamEnabled],
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
  // === auto-squash（GitAutoSquashCommitAction 语义：fixup!/squash! 提交折入选中提交）===
  const { trigger: autosquash } = useAutosquash(repoId);
  const onAutosquash = (action: 'fixup' | 'squash', hash: string): void => {
    Modal.confirm({
      title: action === 'fixup' ? 'Fixup Commit' : 'Squash Commit',
      content: `将以暂存内容创建 ${action}! 提交并折入选中提交（历史将被重写）；无暂存内容请先在状态页暂存`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => autosquash({ hash, action }).then(dispatchRebaseOutcome).catch(onError),
    });
  };
  // === 单提交编辑直通（GitSingleCommitEditingAction 语义：reword/drop/squash/fixup）===
  const { trigger: commitEdit } = useCommitEdit(repoId);
  const ACTION_LABELS: Record<'reword' | 'drop' | 'squash' | 'fixup', string> = {
    reword: '重写提交信息',
    drop: '删除提交（其变更一并丢弃）',
    squash: '并入父提交（提交数 -1，信息合并）',
    fixup: '并入父提交（保留父提交信息，提交数 -1）',
  };
  const onEditCommit = (action: 'reword' | 'drop' | 'squash' | 'fixup', hash: string, message?: string): void => {
    if (action === 'reword') {
      // 信息已由行右键 Modal 收集（message 非空）
      commitEdit({ hash, action, message })
        .then(dispatchRebaseOutcome)
        .catch(onError);
      return;
    }
    Modal.confirm({
      title: `${action === 'drop' ? 'Drop' : action === 'squash' ? 'Squash' : 'Fixup'} Commit`,
      content: `${ACTION_LABELS[action]}（历史将被重写）；冲突时可在冲突页解决`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => commitEdit({ hash, action }).then(dispatchRebaseOutcome).catch(onError),
    });
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
  // PushDialog 确定：rejected 为 200 业务结果（非错误）——#91 联动：记录待重新推的推送体，自动打开 Update 对话框；
  // 其余状态直接分派提示。ref 保存 pendingPush（无需触发重渲染，回调闭包内读取）。
  const pendingPushRef = useRef<PushBody | null>(null);
  const onPushOk = (body: PushBody): void => {
    runRemoteOp(
      () => push(body),
      (outcome) => {
        if (outcome.status === 'rejected') {
          pendingPushRef.current = body;
          setOpenDialog('update');
          void message.warning(outcome.hint ?? '推送被拒绝，请先更新');
        } else {
          setOpenDialog(null);
          if (outcome.status === 'up-to-date') void message.info('已是最新');
          else void message.success('推送完成');
        }
      },
    );
  };
  // UpdateProjectDialog 确定：结果 = fetch 引用数 + pull 状态的组合视图；
  // 若为推送被拒后的更新（pendingPushRef 非空）→ 更新成功（up-to-date/updated）后自动续推原推送体
  const onUpdateOk = (body: UpdateBody): void => {
    const pendingPush = pendingPushRef.current;
    runRemoteOp(
      () => updateProject(body),
      (outcome) => {
        if (outcome.pull.status === 'conflicts') {
          pendingPushRef.current = null;
          setOpenDialog(null);
          void message.warning('更新存在冲突，请解决后完成');
          return;
        }
        if (pendingPush === null) {
          setOpenDialog(null);
          if (outcome.pull.status === 'up-to-date') void message.info('已是最新');
          else void message.success(`更新完成（fetch 更新 ${outcome.fetched.length} 个引用）`);
          return;
        }
        // 推送被拒后的续推：update 成功 → 重推 pendingPush；rejected 再次出现则回到 update （用户改策略再试）
        runRemoteOp(
          () => push(pendingPush),
          (pushOutcome) => {
            if (pushOutcome.status === 'rejected') {
              setOpenDialog('update');
              void message.warning(pushOutcome.hint ?? '推送仍被拒绝，请再次更新');
            } else {
              pendingPushRef.current = null;
              setOpenDialog(null);
              if (pushOutcome.status === 'up-to-date') void message.info('已是最新');
              else void message.success('更新并推送完成');
            }
          },
        );
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
  // 分支对比视图（?compare=<branch>）：双 range 查询就绪前不渲染（compareA/B 为 null key 条件拉取）
  if (compareBranch !== null) {
    if (compareA === undefined || compareB === undefined) return null;
    return (
      <BranchCompareView
        branch={compareBranch}
        branchCommits={compareA.commits}
        currentCommits={compareB.commits}
        onSelectCommit={(hash) => router.push(`/repos/${repoId}?select=${hash}`)}
        onExit={() => router.push(`/repos/${repoId}`)}
      />
    );
  }
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
        onBrowse={(hash) => router.push(`/repos/${repoId}/browse?rev=${hash}`)}
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
        onOpenWorktrees={() => router.push(`/repos/${repoId}/worktrees`)}
        onOpenSubmodules={() => router.push(`/repos/${repoId}/submodules`)}
        onCherryPick={onCherryPick}
        onRevert={onRevert}
        onAutosquash={onAutosquash}
        onEditCommit={onEditCommit}
        onPushUpToCommit={(hash) => {
          setPushUpToHash(hash);
          setOpenDialog('push');
        }}
        onOpenPull={() => setOpenDialog('pull')}
        onOpenPush={() => {
          setPushUpToHash(null);
          setOpenDialog('push');
        }}
        onOpenUpdate={() => setOpenDialog('update')}
        onOpenRemotes={() => router.push(`/repos/${repoId}/remotes`)}
        filters={{ author, path }}
        onFiltersChange={(f) => {
          // 过滤变更：回到首屏窗口（limit 复位 50），选定提交不在窗口时的降级由详情面板缺省逻辑承载
          setAuthor(f.author ?? '');
          setPath(f.path ?? '');
          setLimit(50);
        }}
        hasMore={(page?.hasMore ?? false) && limit < 500}
        loadingMore={logLoading && limit > 50}
        onLoadMore={() => setLimit((prev) => Math.min(prev * 2, 500))}
        onCheckoutRevision={(hash) => {
          Modal.confirm({
            title: '检出此提交',
            content: '将切换到游离 HEAD 状态（建议先确认工作区干净），确定？',
            okText: '确定',
            cancelText: '取消',
            onOk: () =>
              checkout({ action: 'detach', ref: hash })
                .then(() => {
                  void message.success('已检出');
                  void mutateLog();
                })
                .catch(onError),
          });
        }}
        onCheckoutNewBranch={(hash, name) => {
          checkout({ action: 'newBranch', name, startPoint: hash })
            .then(() => void message.success(`已创建并检出分支 ${name}`))
            .catch(onError);
        }}
        onCreateTag={(hash, name, tagMessage) => {
          tagAction({ action: 'create', name, ref: hash, ...(tagMessage === undefined ? {} : { message: tagMessage }) })
            .then(() => void message.success(`已创建标签 ${name}`))
            .catch(onError);
        }}
        onOpenInBrowser={(hash) => {
          // 托管平台提交页链接：GitHub/GitLab 域检测（status 已挂载）；两者皆无 → 不渲染菜单项（回调不注入即隐藏）
          const gh = githubStatus?.repo;
          if (gh !== undefined) {
            window.open(`https://github.com/${gh.owner}/${gh.name}/commit/${hash}`, '_blank', 'noopener');
            return;
          }
          const gl = gitlabStatus?.repo;
          if (gl !== undefined) window.open(`https://gitlab.com/${gl.owner}/${gl.name}/-/commit/${hash}`, '_blank', 'noopener');
        }}
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
        remotes={remotes ?? { remotes: [], shallow: false }}
        confirming={pulling}
        onOk={onPullOk}
        onCancel={() => setOpenDialog(null)}
      />
      <PushDialog
        open={openDialog === 'push'}
        remotes={remotes ?? { remotes: [], shallow: false }}
        currentBranch={status.branch}
        confirming={pushing}
        upToHash={pushUpToHash ?? undefined}
        onOk={onPushOk}
        onCancel={() => {
          setPushUpToHash(null);
          setOpenDialog(null);
        }}
      />
      <UpdateProjectDialog
        open={openDialog === 'update'}
        confirming={updating}
        pushRejected={pendingPushRef.current !== null}
        // Reset to tracked（GitUpdateOptionsDialog 左下，边 #93）：当前分支有上游才展示（Reset 默认关）
        resetToTracked={
          status.branch !== null && status.upstream !== null
            ? { localBranch: status.branch, upstream: status.upstream }
            : undefined
        }
        onResetToTracked={() => {
          if (status.branch === null || status.upstream === null) return;
          Modal.confirm({
            title: 'Reset 到上游分支？',
            content: `将丢弃 ${status.branch} 的工作区/暂存变更，硬重置到 ${status.upstream}；此操作不可恢复`,
            okText: '确定',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () =>
              resetTrigger({ ref: status.upstream!, mode: 'hard' })
                .then(() => {
                  void message.success(`已重置到 ${status.upstream}`);
                  setOpenDialog(null);
                  void mutate();
                })
                .catch(onError),
          });
        }}
        resetting={resetting}
        onOk={onUpdateOk}
        onCancel={() => {
          pendingPushRef.current = null;
          setOpenDialog(null);
        }}
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
