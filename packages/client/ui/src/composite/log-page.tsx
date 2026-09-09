/**
 * 日志页：顶栏（仓库名 + RepoStatusBar + OperationStatus + 变更/分支/合并/贮藏/设置入口 + 「更多」下拉）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit/operation 由调用方容器注入（hooks 数据在应用层装配）。
 * 合并中（operation.kind==='merge'）时顶栏在操作条旁追加「去解决冲突」链接（onOpenConflicts 注入才渲染）。
 * 顶栏收敛：五个页面导航按钮保留为主按钮区；P3-C 只读浏览（溯源/历史/已提交/搜索）与远程相关操作
 * （拉取/推送/更新项目/远程管理）及 P3-D 四入口（补丁/搁置/控制台/忽略）及 GitHub/GitLab 面板
 * 收进「更多」Dropdown，
 * 仅在容器注入对应回调时出现对应菜单项，
 * 回调全缺省时不渲染「更多」按钮。
 */
import { BranchesOutlined, DiffOutlined, InboxOutlined, MergeOutlined, MoreOutlined, RollbackOutlined, SettingOutlined } from '@ant-design/icons';
import { Alert, Button, Dropdown, Flex, Input, Modal, Popconfirm, Skeleton, Typography } from 'antd';
import type { MenuProps } from 'antd';
import type { CommitInfo, CommittedEntry, OperationState, RepoStatus } from '@rebased/contracts';
import { OperationStatus } from '../base/operation-status';
import { RepoStatusBar } from '../domain/repo-status-bar';
import { CommitGraph } from '../domain/commit-graph';
import { CommitDetailsPanel } from '../domain/commit-details-panel';
import { CommittedStatusTag } from '../domain/committed-status';
import { useEffect, useMemo, useState } from 'react';

/** 日志过滤条件（受控：容器持有，变更即重查快照；为空时才是默认全量视图） */
export interface LogFilters {
  author?: string;
  path?: string;
}

export interface LogPageProps {
  repoName: string;
  status: RepoStatus;
  commits: CommitInfo[];
  onSelectCommit?: (hash: string) => void;
  /** 当前选中提交；null/缺省不渲染详情面板 */
  selectedCommit?: CommitInfo | null;
  /** 进行中操作状态；与 onAbortOperation 同传时顶栏渲染操作条 */
  operation?: OperationState;
  /** 中止当前操作回调（经 OperationStatus 的 Popconfirm 确认后触发） */
  onAbortOperation?: () => void;
  /** 中止请求进行中：操作条按钮 loading 态 */
  abortingOperation?: boolean;
  /** 设置入口回调；缺省不渲染设置按钮 */
  /** 设置入口回调；缺省不渲染设置按钮 */
  onOpenSettings?: () => void;
  /** 回首页（欢迎屏）入口回调（File→Close Project 语义）；缺省不渲染「首页」链接 */
  onGoHome?: () => void;
  /** 变更（状态页）入口回调；缺省不渲染变更按钮 */
  onOpenStatus?: () => void;
  /** 分支页入口回调；缺省不渲染分支按钮 */
  onOpenBranches?: () => void;
  /** 合并页入口回调；缺省不渲染合并按钮 */
  onOpenMerge?: () => void;
  /** 贮藏页入口回调；缺省不渲染贮藏按钮 */
  onOpenStashes?: () => void;
  /** 拉取对话框入口回调；缺省时「更多」菜单不含拉取项 */
  onOpenPull?: () => void;
  /** 推送对话框入口回调；缺省时「更多」菜单不含推送项 */
  onOpenPush?: () => void;
  /** 更新项目对话框入口回调；缺省时「更多」菜单不含更新项目项 */
  onOpenUpdate?: () => void;
  /** 远程管理页入口回调；缺省时「更多」菜单不含远程管理项 */
  onOpenRemotes?: () => void;
  /** 变基对话框入口回调；缺省时「更多」菜单不含变基项 */
  onOpenRebase?: () => void;
  /** 标签页入口回调；缺省时「更多」菜单不含标签项 */
  onOpenTags?: () => void;
  /** 冲突页入口回调；仅当 operation.kind==='merge' 时渲染「去解决冲突」链接，缺省不渲染 */
  onOpenConflicts?: () => void;
  /** 溯源页入口回调；缺省时「更多」菜单不含溯源项 */
  onOpenBlame?: () => void;
  /** 文件历史页入口回调；缺省时「更多」菜单不含历史项 */
  onOpenHistory?: () => void;
  /** 已提交变更浏览页入口回调；缺省时「更多」菜单不含已提交项 */
  onOpenCommitted?: () => void;
  /** 提交搜索页入口回调；缺省时「更多」菜单不含搜索项 */
  onOpenSearch?: () => void;
  /** 补丁页入口回调；缺省时「更多」菜单不含补丁项 */
  onOpenPatches?: () => void;
  /** 搁置页入口回调；缺省时「更多」菜单不含搁置项 */
  onOpenShelves?: () => void;
  /** 控制台页入口回调；缺省时「更多」菜单不含控制台项 */
  onOpenConsole?: () => void;
  /** 忽略配置页入口回调；缺省时「更多」菜单不含忽略项 */
  onOpenIgnore?: () => void;
  /** GitHub 面板页入口回调；与 githubAvailable 同传（均为有效值）时「更多」菜单才含 GitHub 面板项 */
  onOpenGithub?: () => void;
  /** GitHub 面板可用性（容器经 useGithubStatus 检测到 GitHub 远程）：false/缺省不渲染 GitHub 面板菜单项 */
  githubAvailable?: boolean;
  /** GitLab 面板页入口回调；与 gitlabAvailable 同传（均为有效值）时「更多」菜单才含 GitLab 面板项 */
  onOpenGitlab?: () => void;
  /** GitLab 面板可用性（容器经 useGitlabStatus 检测到 GitLab 远程）：false/缺省不渲染 GitLab 面板菜单项 */
  gitlabAvailable?: boolean;
  /** 工作树页入口回调；恒渲染（无可用性门——工作树是任何仓库都可达的操作面），缺省时「更多」菜单不含工作树项 */
  onOpenWorktrees?: () => void;
  /** 子模块页入口回调；恒渲染（无可用性门——子模块空态在页面内承载），缺省时「更多」菜单不含子模块项 */
  onOpenSubmodules?: () => void;
  /** 撤销最近提交回调（Popconfirm 确认后触发）；缺省不渲染撤销按钮 */
  onUndoCommit?: () => void;
  /** 撤销请求进行中：撤销按钮 loading 态 */
  undoCommitting?: boolean;
  /** 透传给 CommitDetailsPanel 的「Reset 当前分支到此处」回调；缺省详情面板不渲染该按钮 */
  onResetHere?: (hash: string) => void;
  /** 透传给 CommitDetailsPanel 的「摘樱桃」回调；缺省详情面板不渲染该按钮 */
  onCherryPick?: (hash: string) => void;
  /** 透传给 CommitDetailsPanel 的「还原」回调；缺省详情面板不渲染该按钮 */
  onRevert?: (hash: string) => void;
  /** 透传给 CommitDetailsPanel 的「浏览快照」回调（选中提交 → /browse?rev=）；缺省详情面板不渲染该按钮 */
  onBrowse?: (hash: string) => void;
  /** 透传给 CommitDetailsPanel 的「查看变更集」回调（#13 LogPage → DiffPage 直达：全量变更文件 Modal）；缺省不渲染该按钮 */
  onOpenChanges?: (hash: string) => void;
  /** 变更集 Modal 受控打开键（容器经 useCommitFiles 条件拉取；'' = 关闭） */
  changesHash?: string;
  /** 变更集 Modal 数据（容器条件拉取；null 未就绪 → loading 态） */
  changesEntry?: CommittedEntry | null;
  /** 变更集拉取中 */
  changesLoading?: boolean;
  /** 变更集拉取错误信息 */
  changesError?: string | null;
  /** 关闭变更集 Modal（容器清空 hash 停止拉取） */
  onCloseChanges?: () => void;
  /** 变更集文件行点击（#13：容器据此导航该文件 diff——from=父哈希、to=该提交；根提交降级容器定） */
  onOpenChangedFile?: (path: string) => void;
  /** 过滤条件（受控）；与 onFiltersChange 同传时渲染过滤输入行 */
  filters?: LogFilters;
  /** 过滤变更回调（输入去首尾空白后上抛；清空 = 空对象） */
  onFiltersChange?: (filters: LogFilters) => void;
  /** 「加载更多」可用（快照 hasMore 且未到上限）；缺省不渲染按钮 */
  hasMore?: boolean;
  /** 「加载更多」进行中：按钮 loading 态 */
  loadingMore?: boolean;
  /** 「加载更多」回调（容器增大 limit 重查，推荐 ≤500 阶梯式） */
  onLoadMore?: () => void;
  /** 行右键「检出此提交（游离 HEAD）」回调；缺省不渲染该菜单项 */
  onCheckoutRevision?: (hash: string) => void;
  /** 行右键「从此处新建分支（创建后检出）」回调（hash + 分支名）；缺省不渲染该菜单项 */
  onCheckoutNewBranch?: (hash: string, name: string) => void;
  /** 行右键「从此处新建标签」回调（hash + 标签名 + 可选附注）；缺省不渲染该菜单项 */
  onCreateTag?: (hash: string, name: string, message?: string) => void;
  /** 行右键「在浏览器中打开」（托管平台提交页链接由容器解析）；缺省不渲染该菜单项 */
  onOpenInBrowser?: (hash: string) => void;
  /** 行右键「Fixup/Squash Commit」（GitAutoSquashCommitAction 语义：fixup!/squash! 提交折入目标）；
   *  提供时渲染两项菜单（action + 目标 hash）；缺省不渲染 */
  onAutosquash?: (action: 'fixup' | 'squash', hash: string) => void;
  /** 行右键「Push up to Commit」（GitPushUpToCommitAction 语义：推送该提交到当前分支远端分支）；缺省不渲染该菜单项 */
  onPushUpToCommit?: (hash: string) => void;
  /** 单提交编辑直通（GitSingleCommitEditingAction 语义）：reword（带 message）/drop/squash/fixup（并入父提交）；
   *  提供时渲染「Reword Commit」「Drop Commit」「Squash Commit」「Fixup Commit」四项菜单；缺省不渲染 */
  onEditCommit?: (action: 'reword' | 'drop' | 'squash' | 'fixup', hash: string, message?: string) => void;
}

export function LogPage({
  repoName,
  status,
  commits,
  onSelectCommit,
  selectedCommit,
  operation,
  onAbortOperation,
  abortingOperation,
  onOpenSettings,
  onGoHome,
  onOpenStatus,
  onOpenBranches,
  onOpenMerge,
  onOpenStashes,
  onOpenPull,
  onOpenPush,
  onOpenUpdate,
  onOpenRemotes,
  onOpenRebase,
  onOpenTags,
  onOpenConflicts,
  onOpenBlame,
  onOpenHistory,
  onOpenCommitted,
  onOpenSearch,
  onOpenPatches,
  onOpenShelves,
  onOpenConsole,
  onOpenIgnore,
  onOpenGithub,
  githubAvailable,
  onOpenGitlab,
  gitlabAvailable,
  onOpenWorktrees,
  onOpenSubmodules,
  onUndoCommit,
  undoCommitting,
  onResetHere,
  onCherryPick,
  onRevert,
  onBrowse,
  onOpenChanges,
  changesHash,
  changesEntry,
  changesLoading,
  changesError,
  onCloseChanges,
  onOpenChangedFile,
  filters,
  onFiltersChange,
  hasMore,
  loadingMore,
  onLoadMore,
  onCheckoutRevision,
  onCheckoutNewBranch,
  onCreateTag,
  onOpenInBrowser,
  onAutosquash,
  onPushUpToCommit,
  onEditCommit,
}: LogPageProps): React.ReactNode {
  // 行右键菜单：右键记录 hash（菜单项按 hash 组装），点击项分发对应回调；Modal 输入在菜单项后展开
  const [menuHash, setMenuHash] = useState<string | null>(null);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  // Reword 提交信息输入（GitSingleCommitEditingAction 语义：message 必填——Modal 预填当前主题）
  const [rewordHash, setRewordHash] = useState<string | null>(null);
  const [rewordMessage, setRewordMessage] = useState('');
  const menuItems = useMemo<MenuProps['items']>(() => {
    const hash = menuHash;
    if (hash === null) return [];
    const items: NonNullable<MenuProps['items']> = [];
    if (onCheckoutRevision !== undefined) items.push({ key: 'checkout-revision', label: '检出此提交（游离 HEAD）' });
    if (onCheckoutNewBranch !== undefined) items.push({ key: 'new-branch', label: '从此处新建分支…' });
    if (onCreateTag !== undefined) items.push({ key: 'new-tag', label: '从此处新建标签…' });
    if (onOpenInBrowser !== undefined) items.push({ key: 'open-in-browser', label: '在浏览器中打开' });
    if (items.length > 0) items.push({ type: 'divider' });
    if (onCherryPick !== undefined) items.push({ key: 'cherry-pick', label: '摘樱桃' });
    if (onRevert !== undefined) items.push({ key: 'revert', label: '还原' });
    if (onResetHere !== undefined) items.push({ key: 'reset-here', label: 'Reset 当前分支到此处' });
    if (onBrowse !== undefined) items.push({ key: 'browse', label: '浏览快照' });
    if (onAutosquash !== undefined) {
      items.push({ type: 'divider' });
      items.push({ key: 'fixup-commit', label: 'Fixup Commit' });
      items.push({ key: 'squash-commit', label: 'Squash Commit' });
    }
    if (onPushUpToCommit !== undefined) items.push({ key: 'push-up-to-commit', label: 'Push up to Commit' });
    if (onEditCommit !== undefined) {
      items.push({ type: 'divider' });
      items.push({ key: 'reword-commit', label: 'Reword Commit' });
      items.push({ key: 'drop-commit', label: 'Drop Commit' });
      items.push({ key: 'squash-parent', label: 'Squash Commit（并入父提交）' });
      items.push({ key: 'fixup-parent', label: 'Fixup Commit（并入父提交）' });
    }
    return items;
  }, [menuHash, onCheckoutRevision, onCheckoutNewBranch, onCreateTag, onOpenInBrowser, onCherryPick, onRevert, onResetHere, onBrowse, onAutosquash, onPushUpToCommit, onEditCommit]);
  const onMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (menuHash === null) return;
    if (key === 'checkout-revision') onCheckoutRevision?.(menuHash);
    else if (key === 'new-branch') setBranchModalOpen(true);
    else if (key === 'new-tag') setTagModalOpen(true);
    else if (key === 'open-in-browser') onOpenInBrowser?.(menuHash);
    else if (key === 'cherry-pick') onCherryPick?.(menuHash);
    else if (key === 'revert') onRevert?.(menuHash);
    else if (key === 'reset-here') onResetHere?.(menuHash);
    else if (key === 'browse') onBrowse?.(menuHash);
    else if (key === 'fixup-commit') onAutosquash?.('fixup', menuHash);
    else if (key === 'squash-commit') onAutosquash?.('squash', menuHash);
    else if (key === 'push-up-to-commit') onPushUpToCommit?.(menuHash);
    else if (key === 'reword-commit') {
      setRewordHash(menuHash);
      // 预填当前提交主题首行（message 全量首行；用户可在 Modal 中改写）
      setRewordMessage(commits.find((c) => c.hash === menuHash)?.message.split('\n')[0] ?? '');
    } else if (key === 'drop-commit') onEditCommit?.('drop', menuHash);
    else if (key === 'squash-parent') onEditCommit?.('squash', menuHash);
    else if (key === 'fixup-parent') onEditCommit?.('fixup', menuHash);
  };
  // 过滤输入（受控）：本地草稿即时回显，提交（Enter/失焦）才上抛——避免每击键重查快照
  const [authorDraft, setAuthorDraft] = useState(filters?.author ?? '');
  const [pathDraft, setPathDraft] = useState(filters?.path ?? '');
  useEffect(() => {
    setAuthorDraft(filters?.author ?? '');
    setPathDraft(filters?.path ?? '');
  }, [filters?.author, filters?.path]);
  const applyFilters = (): void => {
    const author = authorDraft.trim();
    const path = pathDraft.trim();
    if (author === (filters?.author ?? '') && path === (filters?.path ?? '')) return;
    onFiltersChange?.({ ...(author === '' ? {} : { author }), ...(path === '' ? {} : { path }) });
  };
  // 「更多」菜单项：仅装配容器注入回调的入口（P3-C 只读浏览 溯源/历史/已提交/搜索 + 本地操作 变基/标签
  // + 远程操作 拉取/推送/更新项目/远程管理 + P3-D 补丁/搁置/控制台/忽略）；全缺省时连「更多」按钮都不渲染
  const moreItems = [
    ...(onOpenBlame ? [{ key: 'blame', label: '溯源' }] : []),
    ...(onOpenHistory ? [{ key: 'history', label: '历史' }] : []),
    ...(onOpenCommitted ? [{ key: 'committed', label: '已提交' }] : []),
    ...(onOpenSearch ? [{ key: 'search', label: '搜索' }] : []),
    ...(onOpenRebase ? [{ key: 'rebase', label: '变基' }] : []),
    ...(onOpenTags ? [{ key: 'tags', label: '标签' }] : []),
    ...(onOpenPull ? [{ key: 'pull', label: '拉取' }] : []),
    ...(onOpenPush ? [{ key: 'push', label: '推送' }] : []),
    ...(onOpenUpdate ? [{ key: 'update', label: '更新项目' }] : []),
    ...(onOpenRemotes ? [{ key: 'remotes', label: '远程管理' }] : []),
    ...(onOpenPatches ? [{ key: 'patches', label: '补丁' }] : []),
    ...(onOpenShelves ? [{ key: 'shelves', label: '搁置' }] : []),
    ...(onOpenConsole ? [{ key: 'console', label: '控制台' }] : []),
    ...(onOpenIgnore ? [{ key: 'ignore', label: '忽略' }] : []),
    // GitHub 面板：仅在容器检测到 GitHub 远程（githubAvailable）且注入导航回调时渲染（对齐 Java 检测到远程才显示工具窗口）
    ...(onOpenGithub !== undefined && githubAvailable ? [{ key: 'github', label: 'GitHub 面板' }] : []),
    // GitLab 面板：与 GitHub 面板项并排、各自检测（容器经 useGitlabStatus 判定 gitlabAvailable）
    ...(onOpenGitlab !== undefined && gitlabAvailable ? [{ key: 'gitlab', label: 'GitLab 面板' }] : []),
    // 工作树/子模块：恒渲染（无可用性门——本域无外部依赖，任何仓库可达；子模块空态在页面内承载）
    ...(onOpenWorktrees ? [{ key: 'worktrees', label: '工作树' }] : []),
    ...(onOpenSubmodules ? [{ key: 'submodules', label: '子模块' }] : []),
  ];
  /** 「更多」菜单点击分发：按 key 调对应入口回调 */
  const onMoreClick = (key: string): void => {
    if (key === 'blame') onOpenBlame?.();
    else if (key === 'history') onOpenHistory?.();
    else if (key === 'committed') onOpenCommitted?.();
    else if (key === 'search') onOpenSearch?.();
    else if (key === 'rebase') onOpenRebase?.();
    else if (key === 'tags') onOpenTags?.();
    else if (key === 'pull') onOpenPull?.();
    else if (key === 'push') onOpenPush?.();
    else if (key === 'update') onOpenUpdate?.();
    else if (key === 'remotes') onOpenRemotes?.();
    else if (key === 'patches') onOpenPatches?.();
    else if (key === 'shelves') onOpenShelves?.();
    else if (key === 'console') onOpenConsole?.();
    else if (key === 'ignore') onOpenIgnore?.();
    else if (key === 'github') onOpenGithub?.();
    else if (key === 'gitlab') onOpenGitlab?.();
    else if (key === 'worktrees') onOpenWorktrees?.();
    else if (key === 'submodules') onOpenSubmodules?.();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #f0f0f0' }}>
        {/* 回首页（File→Close Project 语义）：顶栏最左「首页」链接；仅容器注入回调时渲染 */}
        {onGoHome ? (
          <Button type="link" size="small" data-testid="log-go-home" onClick={onGoHome}>
            首页
          </Button>
        ) : null}
        <span style={{ fontWeight: 600, padding: '4px 8px' }}>{repoName}</span>
        <RepoStatusBar status={status} />
        {/* 进行中操作条：仅当容器同时注入 operation 与中止回调时渲染 */}
        {operation && onAbortOperation ? (
          <OperationStatus operation={operation} onAbort={onAbortOperation} aborting={abortingOperation} />
        ) : null}
        {/* 「去解决冲突」链接：仅合并进行中（operation.kind==='merge'）且容器注入导航回调时渲染，
            跟在操作条旁；base 组件 OperationStatus 不背导航职责，故由本层自行渲染 */}
        {operation?.kind === 'merge' && onOpenConflicts ? (
          <Button type="link" size="small" onClick={onOpenConflicts}>
            去解决冲突
          </Button>
        ) : null}
        {/* 撤销最近提交：Popconfirm 确认后回调（保留改动到暂存区，等价 reset --soft HEAD~1） */}
        {onUndoCommit ? (
          <Popconfirm
            title="将撤销最近提交并保留改动到暂存区"
            okText="确定"
            cancelText="取消"
            onConfirm={onUndoCommit}
          >
            <Button
              aria-label="撤销最近提交"
              type="text"
              icon={<RollbackOutlined />}
              loading={undoCommitting}
            />
          </Popconfirm>
        ) : null}
        {/* 变更入口（状态页）：在设置按钮旁、靠右对齐；仅在容器注入导航回调时渲染 */}
        {onOpenStatus ? (
          <Button
            aria-label="变更"
            type="text"
            icon={<DiffOutlined />}
            onClick={onOpenStatus}
            style={{ marginLeft: 'auto' }}
          />
        ) : null}
        {/* 分支入口：排在变更与设置之间；变更按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenBranches ? (
          <Button
            aria-label="分支"
            type="text"
            icon={<BranchesOutlined />}
            onClick={onOpenBranches}
            style={onOpenStatus ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 合并入口：排在分支与设置之间；前面按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenMerge ? (
          <Button
            aria-label="合并"
            type="text"
            icon={<MergeOutlined />}
            onClick={onOpenMerge}
            style={onOpenStatus || onOpenBranches ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 贮藏入口：排在合并与设置之间；前面按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenStashes ? (
          <Button
            aria-label="贮藏"
            type="text"
            icon={<InboxOutlined />}
            onClick={onOpenStashes}
            style={onOpenStatus || onOpenBranches || onOpenMerge ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 设置入口靠右对齐；变更/分支/合并/贮藏按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenSettings ? (
          <Button
            aria-label="设置"
            type="text"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
            style={onOpenStatus || onOpenBranches || onOpenMerge || onOpenStashes ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 「更多」Dropdown：远程相关操作（拉取/推送/更新项目/远程管理）的收敛入口，跟在设置按钮之后；
            前面按钮已占位（marginLeft:auto）时不再重复右推 */}
        {moreItems.length > 0 ? (
          <Dropdown trigger={['click']} menu={{ items: moreItems, onClick: ({ key }) => onMoreClick(key) }}>
            <Button
              aria-label="更多"
              type="text"
              icon={<MoreOutlined />}
              style={
                onOpenStatus || onOpenBranches || onOpenMerge || onOpenStashes || onOpenSettings
                  ? undefined
                  : { marginLeft: 'auto' }
              }
            />
          </Dropdown>
        ) : null}
      </div>
      {/* 过滤/分页行：仅容器同时注入过滤回调时渲染（过滤受控，Enter/失焦提交防每击键重查）；
          加载更多按 hasMore 展示（服务端 limit≤500，容器按阶梯放大重查） */}
      {onFiltersChange !== undefined ? (
        <div
          data-testid="log-filter-row"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}
        >
          <Input
            data-testid="log-filter-author"
            placeholder="作者过滤"
            allowClear
            size="small"
            style={{ width: 180 }}
            value={authorDraft}
            onChange={(e) => setAuthorDraft(e.target.value)}
            onPressEnter={applyFilters}
            onBlur={applyFilters}
          />
          <Input
            data-testid="log-filter-path"
            placeholder="路径过滤（如 src/）"
            allowClear
            size="small"
            style={{ width: 220 }}
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onPressEnter={applyFilters}
            onBlur={applyFilters}
          />
          {hasMore !== undefined && onLoadMore !== undefined ? (
            <Button
              size="small"
              data-testid="log-load-more"
              disabled={!hasMore}
              loading={loadingMore}
              onClick={onLoadMore}
              style={{ marginLeft: 'auto' }}
            >
              加载更多
            </Button>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {/* 行右键菜单（Java Vcs.Log.ContextMenu 组）：菜单项按 menuHash 组装，右键行记录 hash；
              antd Dropdown trigger=contextMenu 自动定位光标处并阻止浏览器默认菜单 */}
          <Dropdown trigger={['contextMenu']} menu={{ items: menuItems, onClick: onMenuClick }}>
            <div style={{ height: '100%' }}>
              <CommitGraph commits={commits} onSelect={onSelectCommit} onContextMenu={setMenuHash} />
            </div>
          </Dropdown>
        </div>
        {selectedCommit ? (
          <div
            data-testid="commit-details"
            style={{ width: 320, flexShrink: 0, borderLeft: '1px solid #f0f0f0', overflow: 'auto' }}
          >
            <CommitDetailsPanel
              commit={selectedCommit}
              onResetHere={onResetHere}
              onCherryPick={onCherryPick}
              onRevert={onRevert}
              onBrowse={onBrowse}
              onOpenChanges={onOpenChanges}
            />
          </div>
        ) : null}
      </div>
      {/* 行右键 Modal：从此处新建分支（创建+检出语义由容器经 checkout newBranch 承载）/ 新建标签（附注可选） */}
      <Modal
        title="从此处新建分支"
        open={branchModalOpen && menuHash !== null}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: branchName.trim() === '' }}
        onOk={() => {
          if (menuHash !== null && branchName.trim() !== '') onCheckoutNewBranch?.(menuHash, branchName.trim());
          setBranchName('');
          setBranchModalOpen(false);
        }}
        onCancel={() => {
          setBranchName('');
          setBranchModalOpen(false);
        }}
      >
        <Input
          data-testid="log-branch-name"
          placeholder="分支名（如 feature/xxx）"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
        />
      </Modal>
      <Modal
        title="从此处新建标签"
        open={tagModalOpen && menuHash !== null}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: tagName.trim() === '' }}
        onOk={() => {
          const message = tagMessage.trim();
          if (menuHash !== null && tagName.trim() !== '') {
            onCreateTag?.(menuHash, tagName.trim(), message === '' ? undefined : message);
          }
          setTagName('');
          setTagMessage('');
          setTagModalOpen(false);
        }}
        onCancel={() => {
          setTagName('');
          setTagMessage('');
          setTagModalOpen(false);
        }}
      >
        <Flex vertical gap={8}>
          <Input
            data-testid="log-tag-name"
            placeholder="标签名（如 v1.0.0）"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
          />
          <Input
            data-testid="log-tag-message"
            placeholder="附注信息（可选；留空为轻量标签）"
            value={tagMessage}
            onChange={(e) => setTagMessage(e.target.value)}
          />
        </Flex>
      </Modal>
      {/* Reword 提交信息（单提交编辑直通：message 必填——经交互式变基 reword + GIT_EDITOR 消息 shim 覆写） */}
      <Modal
        title="Reword Commit"
        open={rewordHash !== null}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: rewordMessage.trim() === '' }}
        onOk={() => {
          if (rewordHash !== null && rewordMessage.trim() !== '') {
            onEditCommit?.('reword', rewordHash, rewordMessage.trim());
          }
          setRewordHash(null);
        }}
        onCancel={() => setRewordHash(null)}
      >
        <Input.TextArea
          data-testid="reword-message-input"
          placeholder="新的提交信息"
          autoSize={{ minRows: 2, maxRows: 6 }}
          value={rewordMessage}
          onChange={(e) => setRewordMessage(e.target.value)}
        />
      </Modal>
      {/* 查看变更集（#13 LogPage → DiffPage 直达）：选中提交的全量变更文件 Modal——行点击 → 该文件
          diff（from=父哈希、to=该提交；根提交降级由容器定）；数据由容器经 useCommitFiles 条件拉取 */}
      <Modal
        title={`变更集（${changesEntry?.shortHash ?? (changesHash === undefined || changesHash === '' ? '' : changesHash.slice(0, 7))}）`}
        open={changesHash !== undefined && changesHash !== ''}
        okText="关闭"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={onCloseChanges}
        onCancel={onCloseChanges}
      >
        {changesLoading ? (
          <Skeleton active />
        ) : changesError !== undefined && changesError !== null ? (
          <Alert type="error" showIcon message={changesError} />
        ) : changesEntry === undefined || changesEntry === null ? (
          <Typography.Text type="secondary">暂无变更文件</Typography.Text>
        ) : (
          <Flex vertical gap={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {changesEntry.subject}
            </Typography.Text>
            {changesEntry.files.map((file) => (
              <Flex key={`${file.status}-${file.path}`} align="center" gap={8}>
                <CommittedStatusTag status={file.status} />
                <Typography.Text
                  data-testid={`changes-file-${file.path}`}
                  style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
                  ellipsis
                  onClick={() => onOpenChangedFile?.(file.path)}
                >
                  {file.renameFrom !== undefined ? `${file.renameFrom} → ${file.path}` : file.path}
                </Typography.Text>
              </Flex>
            ))}
          </Flex>
        )}
      </Modal>
    </div>
  );
}
