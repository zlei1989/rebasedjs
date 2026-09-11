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
import { Alert, Button, Col, Dropdown, Flex, Input, Modal, Popconfirm, Row, Skeleton, Space, Switch, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import type { CommitInfo, CommittedEntry, OperationState, RepoStatus } from '@rebased/contracts';
import { OperationStatus } from '../base/operation-status';
import { EmptyState } from '../base/empty-state';
import { PageShell } from '../base/page-shell';
import { SplitPane } from '../base/split-pane';
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
  // 顶栏/过滤行/详情面板分隔线走主题 token（原 #f0f0f0 硬编码在暗色主题下过亮）
  const { token } = theme.useToken();
  // 行右键菜单：右键记录 hash（菜单项按 hash 组装），点击项分发对应回调；Modal 输入在菜单项后展开
  const [menuHash, setMenuHash] = useState<string | null>(null);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  // tag chips 显示开关（默认关，对齐 Java VcsLogApplicationSettings.showTagNames 默认 false）
  const [showTags, setShowTags] = useState(false);
  // 提交图整块的 Tooltip 受控状态：图内每一行自带 Tooltip，悬停到行上时必须抑制整块气泡，
  // 否则行气泡与整图气泡会同时弹出（与 repo-page 的 hoverId/actionHoverId 同一思路）
  const [graphHovered, setGraphHovered] = useState(false);
  const [graphRowHovered, setGraphRowHovered] = useState(false);
  /**
   * 「更多」菜单是否展开：展开期间抑制触发按钮的气泡。
   * 原因（浏览器实测）：按钮在页面顶部，气泡会被 antd 翻到下方，正好压住菜单顶部若干项——
   * elementFromPoint 命中的是气泡容器，菜单项既出不了高亮也出不了自己的气泡。
   */
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // Reword 提交信息输入（GitSingleCommitEditingAction 语义：message 必填——Modal 预填当前主题）
  const [rewordHash, setRewordHash] = useState<string | null>(null);
  const [rewordMessage, setRewordMessage] = useState('');
  const menuItems = useMemo<MenuProps['items']>(() => {
    const hash = menuHash;
    if (hash === null) return [];
    const items: NonNullable<MenuProps['items']> = [];
    // 菜单项 label 用 Tooltip > span 包裹：菜单项是数据对象而非 JSX，antd 的 MenuItemType.title 在 Dropdown 下不弹；
    // span 让 antd 的菜单项样式（行高/省略/禁用色）照旧生效，Tooltip 只负责悬停说明
    if (onCheckoutRevision !== undefined) items.push({ key: 'checkout-revision', label: <Tooltip title="检出该提交：工作区换成它的快照，HEAD 进入游离状态（不移动任何分支）"><span>检出此提交（游离 HEAD）</span></Tooltip> });
    if (onCheckoutNewBranch !== undefined) items.push({ key: 'new-branch', label: <Tooltip title="以该提交为起点新建分支：随后弹出对话框填写分支名，创建后不自动检出"><span>从此处新建分支…</span></Tooltip> });
    if (onCreateTag !== undefined) items.push({ key: 'new-tag', label: <Tooltip title="以该提交为起点新建标签：随后弹出对话框填写标签名与说明"><span>从此处新建标签…</span></Tooltip> });
    if (onOpenInBrowser !== undefined) items.push({ key: 'open-in-browser', label: <Tooltip title="在系统浏览器中打开该提交对应的远程网页（需已配置远程仓库）"><span>在浏览器中打开</span></Tooltip> });
    if (items.length > 0) items.push({ type: 'divider' });
    if (onCherryPick !== undefined) items.push({ key: 'cherry-pick', label: <Tooltip title="把该提交的改动复制到当前分支（cherry-pick）"><span>摘樱桃</span></Tooltip> });
    if (onRevert !== undefined) items.push({ key: 'revert', label: <Tooltip title="生成一个反向提交来撤销该提交的改动（原提交仍留在历史里）"><span>还原</span></Tooltip> });
    if (onResetHere !== undefined) items.push({ key: 'reset-here', label: <Tooltip title="把当前分支指针移到该提交：其后的提交将从分支历史上移除（可用 reflog 找回）"><span>Reset 当前分支到此处</span></Tooltip> });
    if (onBrowse !== undefined) items.push({ key: 'browse', label: <Tooltip title="只读查看该提交时刻的完整文件树快照（不检出、不改动工作区）"><span>浏览快照</span></Tooltip> });
    if (onAutosquash !== undefined) {
      items.push({ type: 'divider' });
      items.push({ key: 'fixup-commit', label: <Tooltip title="生成 fixup! 提交并指向该提交：留待交互式变基（autosquash）时自动并入"><span>Fixup Commit</span></Tooltip> });
      items.push({ key: 'squash-commit', label: <Tooltip title="生成 squash! 提交并指向该提交：改动保留、提交信息待变基时合并编辑"><span>Squash Commit</span></Tooltip> });
    }
    if (onPushUpToCommit !== undefined) items.push({ key: 'push-up-to-commit', label: <Tooltip title="把远程分支推进到该提交为止：其后的远端提交将从远端历史丢弃（需 force-push，不可恢复）"><span>Push up to Commit</span></Tooltip> });
    if (onEditCommit !== undefined) {
      items.push({ type: 'divider' });
      items.push({ key: 'reword-commit', label: <Tooltip title="改写该提交的提交信息：该提交及其之后的所有提交哈希都会被重写"><span>Reword Commit</span></Tooltip> });
      items.push({ key: 'drop-commit', label: <Tooltip title="从历史中删除该提交：其改动一并丢弃，不可恢复"><span>Drop Commit</span></Tooltip> });
      items.push({ key: 'squash-parent', label: <Tooltip title="把该提交的改动与提交信息并入父提交：该提交消失，历史被重写"><span>Squash Commit（并入父提交）</span></Tooltip> });
      items.push({ key: 'fixup-parent', label: <Tooltip title="把该提交的改动并入父提交并丢弃其提交信息：历史被重写"><span>Fixup Commit（并入父提交）</span></Tooltip> });
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
    ...(onOpenBlame ? [{ key: 'blame', label: <Tooltip title="打开逐行溯源视图：查看每一行的最后修改者与提交"><span>溯源</span></Tooltip> }] : []),
    ...(onOpenHistory ? [{ key: 'history', label: <Tooltip title="打开该文件的提交历史：只看改动过它的记录"><span>历史</span></Tooltip> }] : []),
    ...(onOpenCommitted ? [{ key: 'committed', label: <Tooltip title="查看当前分支上已提交但尚未推送的提交清单"><span>已提交</span></Tooltip> }] : []),
    ...(onOpenSearch ? [{ key: 'search', label: <Tooltip title="在整个仓库历史中按提交信息、作者或文件内容检索"><span>搜索</span></Tooltip> }] : []),
    ...(onOpenRebase ? [{ key: 'rebase', label: <Tooltip title="打开变基对话框：把当前分支的提交重新应用到指定基底（会重写提交哈希）"><span>变基</span></Tooltip> }] : []),
    ...(onOpenTags ? [{ key: 'tags', label: <Tooltip title="打开标签管理页：查看、创建或删除仓库标签"><span>标签</span></Tooltip> }] : []),
    ...(onOpenPull ? [{ key: 'pull', label: <Tooltip title="从远程拉取最新提交并合入当前分支"><span>拉取</span></Tooltip> }] : []),
    ...(onOpenPush ? [{ key: 'push', label: <Tooltip title="把当前分支的本地提交推送到远程跟踪分支"><span>推送</span></Tooltip> }] : []),
    ...(onOpenUpdate ? [{ key: 'update', label: <Tooltip title="按配置的同步策略从远程更新当前分支（合并或变基）"><span>更新项目</span></Tooltip> }] : []),
    ...(onOpenRemotes ? [{ key: 'remotes', label: <Tooltip title="管理远程仓库：查看、新增、编辑或删除远程地址"><span>远程管理</span></Tooltip> }] : []),
    ...(onOpenPatches ? [{ key: 'patches', label: <Tooltip title="补丁工具：把改动导出为补丁文件，或把补丁应用到工作区"><span>补丁</span></Tooltip> }] : []),
    ...(onOpenShelves ? [{ key: 'shelves', label: <Tooltip title="搁置区：临时存放未完成的改动，之后可取出恢复"><span>搁置</span></Tooltip> }] : []),
    ...(onOpenConsole ? [{ key: 'console', label: <Tooltip title="打开 Git 控制台：在当前仓库直接执行 git 命令并查看输出"><span>控制台</span></Tooltip> }] : []),
    ...(onOpenIgnore ? [{ key: 'ignore', label: <Tooltip title="编辑忽略规则：把选中的文件或目录加入 .gitignore，之后不再视为未跟踪变更"><span>忽略</span></Tooltip> }] : []),
    // GitHub 面板：仅在容器检测到 GitHub 远程（githubAvailable）且注入导航回调时渲染（对齐 Java 检测到远程才显示工具窗口）
    ...(onOpenGithub !== undefined && githubAvailable ? [{ key: 'github', label: <Tooltip title="打开 GitHub 面板：查看该仓库关联的 PR、议题与动态"><span>GitHub 面板</span></Tooltip> }] : []),
    // GitLab 面板：与 GitHub 面板项并排、各自检测（容器经 useGitlabStatus 判定 gitlabAvailable）
    ...(onOpenGitlab !== undefined && gitlabAvailable ? [{ key: 'gitlab', label: <Tooltip title="打开 GitLab 面板：查看该仓库关联的 MR、议题与动态"><span>GitLab 面板</span></Tooltip> }] : []),
    // 工作树/子模块：恒渲染（无可用性门——本域无外部依赖，任何仓库可达；子模块空态在页面内承载）
    ...(onOpenWorktrees ? [{ key: 'worktrees', label: <Tooltip title="管理工作树：查看并新增或删除同一仓库的多个检出目录"><span>工作树</span></Tooltip> }] : []),
    ...(onOpenSubmodules ? [{ key: 'submodules', label: <Tooltip title="管理子模块：查看状态、初始化或更新嵌套仓库"><span>子模块</span></Tooltip> }] : []),
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
  // 主区（提交图）：与右侧详情面板共同构成两栏——宽屏并排、窄屏纵向堆叠由 SplitPane 承担。
  // 提取成变量是因为详情面板按需出现（未选中提交时整块不渲染），而 SplitPane 的侧栏宿主恒存在：
  // 把条件放进 side 会让默认视图（未选中）右侧永久留一条 320px 空列，故两栏块整体按需切换。
  const graphArea = (
    <>
      {/* 空仓（unborn HEAD，如刚 init）与过滤无命中：显式空态——否则整片空白无法区分「在加载」与「没有提交」 */}
      {commits.length === 0 ? (
        <EmptyState title="暂无提交" description="该仓库还没有任何提交，或当前过滤条件没有匹配结果" />
      ) : (
        /* 行右键菜单（Java Vcs.Log.ContextMenu 组）：菜单项按 menuHash 组装，右键行记录 hash；
           antd Dropdown trigger=contextMenu 自动定位光标处并阻止浏览器默认菜单 */
        <Dropdown trigger={['contextMenu']} menu={{ items: menuItems, onClick: onMenuClick }}>
          {/* 提交图整块也要有 tooltip（行点击/右键由图上每一行承载）。
              Tooltip 的 child 必须能接 ref 与 hover 事件：刻意交给下面这层真实 div 承接，
              而不是把函数组件 CommitGraph 直接当子节点（那样拿不到 ref，气泡不会出现）。
              open 受控：指针落进某一行时抑制整图气泡，行自带的气泡才是这一刻该显示的那个 */}
          <Tooltip
            open={graphHovered && !graphRowHovered}
            title="提交图区域：单击某行可查看该提交详情，右键某行可打开该提交的操作菜单"
          >
            <div
              style={{ height: '100%' }}
              onMouseEnter={() => setGraphHovered(true)}
              onMouseLeave={() => {
                setGraphHovered(false);
                setGraphRowHovered(false);
              }}
              // onMouseOver 会冒泡：用事件目标判断指针是否落在提交行（commit-graph 渲染的 data-testid）上
              onMouseOver={(event) => {
                const target = event.target;
                setGraphRowHovered(
                  target instanceof Element && target.closest('[data-testid="commit-graph-row"]') !== null,
                );
              }}
            >
              <CommitGraph
                commits={commits}
                onSelect={onSelectCommit}
                onContextMenu={setMenuHash}
                showTags={showTags}
                selectedHash={selectedCommit?.hash ?? null}
              />
            </div>
          </Tooltip>
        </Dropdown>
      )}
    </>
  );
  // 页面根：PageShell 自带纵向 Flex + width:100% + minWidth:0 + height:100%（并施加紧凑密度）。
  // LogPage 是路由根（两端容器均以裸 fragment 直接渲染它），故密度归本页所有——不传 density 即默认 compact。
  // 原根节点既无 gap 也无 padding，故这里都不传（PageShell 默认不落 style，传了会凭空新增间距）。
  return (
    <PageShell>
      {/* 顶栏两端布局：Grid（Row/Col）负责「左信息区 ←→ 右操作区」两端分布，Space 负责两侧组内间距。
          为什么不再用 `marginLeft:auto` 逐个占位：那是「凑」出右端，可选按钮一多，每个按钮都要按
          「前面还有哪个按钮会渲染」重算一遍条件（原代码里那串 `onOpenStatus || onOpenBranches || …` 就是）；
          改成两端容器后左右各自成组，右端位置与按钮渲染条件彻底解耦。
          注意两点：
          1) Row/Col 从 'antd' 顶层具名导入；`Grid` 这个具名导出在 antd 6.6.1 运行时只有 useBreakpoint
             （`es/grid/index.js` 只 default 出 { Col, Row, useBreakpoint }），在它上面解构 Row/Col 会拿到 undefined。
          2) Row 默认 flexWrap='wrap'，且 Col 默认 `flex: 0 0 auto`（不收缩）——左侧必须显式给
             flex:'1 1 auto' + minWidth:0 才能被压缩（否则撑开 Row 把操作区挤到第二行）。 */}
      <Row
        data-testid="log-topbar"
        align="middle"
        justify="space-between"
        style={{ borderBottom: `1px solid ${token.colorSplit}` }}
      >
        {/* 左侧信息区：首页入口 + 仓库名 + 分支状态条 + 进行中操作条；整体可收缩（窄屏优先压缩这一侧） */}
        <Col style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {/* size={16} 承接原手写 gap 16（两项的列间距）；Space 默认 align="center" 与原 items 垂直居中一致 */}
          <Space size={16} style={{ minWidth: 0 }}>
            {/* 回首页（File→Close Project 语义）：顶栏最左「首页」链接；仅容器注入回调时渲染 */}
            {onGoHome ? (
              <Tooltip title="回到首页欢迎屏：关闭当前仓库视图，不改动仓库里的任何内容">
                <Button type="link" size="small" data-testid="log-go-home" onClick={onGoHome}>
                  首页
                </Button>
              </Tooltip>
            ) : null}
            {/* minWidth:0 + overflow:hidden 让长仓库名可被压缩并走 ellipsis，而不是把右端操作挤出屏幕 */}
            <span style={{ fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{repoName}</span>
            <RepoStatusBar status={status} />
            {/* 进行中操作条：仅当容器同时注入 operation 与中止回调时渲染 */}
            {operation && onAbortOperation ? (
              <OperationStatus operation={operation} onAbort={onAbortOperation} aborting={abortingOperation} />
            ) : null}
            {/* 「去解决冲突」链接：仅合并进行中（operation.kind==='merge'）且容器注入导航回调时渲染，
                跟在操作条旁；base 组件 OperationStatus 不背导航职责，故由本层自行渲染 */}
            {operation?.kind === 'merge' && onOpenConflicts ? (
              <Tooltip title="打开冲突解决页：逐个文件处理合并冲突，解决完再提交以结束合并">
                <Button type="link" size="small" onClick={onOpenConflicts}>
                  去解决冲突
                </Button>
              </Tooltip>
            ) : null}
          </Space>
        </Col>
        {/* 右侧操作区：撤销/变更/分支/合并/贮藏/设置/更多 七个入口，靠 justify="space-between" 贴右端 */}
        <Col style={{ flexShrink: 0 }}>
          <Space size={4}>
            {/* 撤销最近提交：Popconfirm 确认后回调（保留改动到暂存区，等价 reset --soft HEAD~1） */}
            {onUndoCommit ? (
              <Popconfirm
                title="将撤销最近提交并保留改动到暂存区"
                okText="确定"
                cancelText="取消"
                onConfirm={onUndoCommit}
              >
                {/* Tooltip 必须放在 Popconfirm 内侧：放外侧会截断 Popconfirm 的点击触发链，确认气泡就不再出现 */}
                <Tooltip title="回退最近一次提交并保留全部改动到暂存区（等价 reset --soft HEAD~1），提交记录会少一笔">
                  <Button
                    aria-label="撤销最近提交"
                    type="text"
                    icon={<RollbackOutlined />}
                    loading={undoCommitting}
                  />
                </Tooltip>
              </Popconfirm>
            ) : null}
            {/* 变更入口（状态页）：在设置按钮旁、靠右对齐；仅在容器注入导航回调时渲染 */}
            {onOpenStatus ? (
              <Tooltip title="打开变更页：查看工作区与暂存区的文件改动，逐个文件对照差异">
                <Button
                  aria-label="变更"
                  type="text"
                  icon={<DiffOutlined />}
                  onClick={onOpenStatus}
                />
              </Tooltip>
            ) : null}
            {/* 分支入口：排在变更与设置之间 */}
            {onOpenBranches ? (
              <Tooltip title="打开分支页：查看本地/远程分支并执行新建、检出、合并等操作">
                <Button
                  aria-label="分支"
                  type="text"
                  icon={<BranchesOutlined />}
                  onClick={onOpenBranches}
                />
              </Tooltip>
            ) : null}
            {/* 合并入口：排在分支与设置之间 */}
            {onOpenMerge ? (
              <Tooltip title="打开合并页：把选定的分支或提交并入当前分支">
                <Button
                  aria-label="合并"
                  type="text"
                  icon={<MergeOutlined />}
                  onClick={onOpenMerge}
                />
              </Tooltip>
            ) : null}
            {/* 贮藏入口：排在合并与设置之间 */}
            {onOpenStashes ? (
              <Tooltip title="打开贮藏页：把未提交的改动暂存起来，或把已有贮藏重新应用回工作区">
                <Button
                  aria-label="贮藏"
                  type="text"
                  icon={<InboxOutlined />}
                  onClick={onOpenStashes}
                />
              </Tooltip>
            ) : null}
            {/* 设置入口 */}
            {onOpenSettings ? (
              <Tooltip title="打开设置页：调整当前仓库的 git 配置、账户与外观偏好">
                <Button
                  aria-label="设置"
                  type="text"
                  icon={<SettingOutlined />}
                  onClick={onOpenSettings}
                />
              </Tooltip>
            ) : null}
            {/* 「更多」Dropdown：远程相关操作（拉取/推送/更新项目/远程管理）的收敛入口，跟在设置按钮之后 */}
            {moreItems.length > 0 ? (
              <Dropdown
                trigger={['click']}
                onOpenChange={setMoreMenuOpen}
                menu={{ items: moreItems, onClick: ({ key }) => onMoreClick(key) }}
              >
                {/* Tooltip 放在 Dropdown 内侧：Dropdown 需要直接包裹真实控件才能接住点击触发 */}
                <Tooltip
                  title="更多功能：只读浏览（溯源/历史/已提交/搜索）、本地操作与远程操作统一收在这里"
                  open={moreMenuOpen ? false : undefined}
                >
                  <Button aria-label="更多" type="text" icon={<MoreOutlined />} />
                </Tooltip>
              </Dropdown>
            ) : null}
          </Space>
        </Col>
      </Row>
      {/* 过滤/分页行：仅容器同时注入过滤回调时渲染（过滤受控，Enter/失焦提交防每击键重查）；
          窄屏（≤768）允许换行，避免输入框/开关被压成竖排文字 */}
      {onFiltersChange !== undefined ? (
        <div
          data-testid="log-filter-row"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', flexWrap: 'wrap', borderBottom: `1px solid ${token.colorSplit}` }}
        >
          <Tooltip title="按作者过滤提交：支持姓名或邮箱片段，回车或失焦才生效">
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
          </Tooltip>
          <Tooltip title="按路径过滤提交：填目录或文件前缀（如 src/），回车或失焦才生效">
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
          </Tooltip>
          {/* tag chips 显示开关（对齐 Java VcsLogApplicationSettings.showTagNames：分支 chips 恒显、tag 默认关可开） */}
          <Flex align="center" gap={4} style={{ whiteSpace: 'nowrap' }}>
            <Tooltip title="在提交行上显示 tag 标签 chip：开启后能看到每个提交被打了哪些标签">
              <Switch
                size="small"
                data-testid="log-show-tags"
                checked={showTags}
                onChange={setShowTags}
              />
            </Tooltip>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              标签
            </Typography.Text>
          </Flex>
          {hasMore !== undefined && onLoadMore !== undefined ? (
            // 到达快照上限时按钮禁用；禁用按钮不派发 hover，故在 Tooltip 与 Button 之间包 span 承接悬停。
            // 外层 span 承接原先挂在按钮上的 marginLeft:auto（按钮自身 style 保持不变），右对齐位置不变
            <Tooltip title={hasMore ? '继续加载更早的提交：按阶梯放大查询数量，结果追加在列表下方' : '已到本次快照的加载上限：请收窄过滤条件或重新查询后再加载'}>
              <span style={{ marginLeft: 'auto' }}>
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
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      {/* 两栏：主区（提交图）+ 右侧详情面板（320）；未选中提交时退化为主区独占满宽 */}
      {selectedCommit ? (
        <SplitPane
          sidePosition="end"
          sideWidth={320}
          side={
            /* 分隔线是侧栏自身的视觉分隔（SplitPane 只做布局、不画线），故保留在调用点；
               宽度 320 / flexShrink:0 / 内部滚动均已由 SplitPane 的侧栏宿主承担，此处不再重复 */
            <div data-testid="commit-details" style={{ borderLeft: `1px solid ${token.colorSplit}` }}>
              <CommitDetailsPanel
                commit={selectedCommit}
                onResetHere={onResetHere}
                onCherryPick={onCherryPick}
                onRevert={onRevert}
                onBrowse={onBrowse}
                onOpenChanges={onOpenChanges}
              />
            </div>
          }
        >
          {graphArea}
        </SplitPane>
      ) : (
        /* 未选中提交：不渲染侧栏宿主，主区独占满宽（盒子几何与 SplitPane 的主区宿主一致） */
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>{graphArea}</div>
      )}
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
        <Tooltip title="新分支名（必填）：以该提交为起点创建并立即检出，留空时「确定」保持禁用">
          <Input
            data-testid="log-branch-name"
            placeholder="分支名（如 feature/xxx）"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
          />
        </Tooltip>
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
          <Tooltip title="新标签名（必填）：以该提交为起点创建标签，留空时「确定」保持禁用">
            <Input
              data-testid="log-tag-name"
              placeholder="标签名（如 v1.0.0）"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
            />
          </Tooltip>
          <Tooltip title="标签附注（可选）：填写会创建带说明的附注标签，留空则创建轻量标签">
            <Input
              data-testid="log-tag-message"
              placeholder="附注信息（可选；留空为轻量标签）"
              value={tagMessage}
              onChange={(e) => setTagMessage(e.target.value)}
            />
          </Tooltip>
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
        <Tooltip title="改写后的提交信息（必填）：经交互式变基 reword 覆盖原信息，留空时「确定」保持禁用">
          <Input.TextArea
            data-testid="reword-message-input"
            placeholder="新的提交信息"
            autoSize={{ minRows: 2, maxRows: 6 }}
            value={rewordMessage}
            onChange={(e) => setRewordMessage(e.target.value)}
          />
        </Tooltip>
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
          <Alert type="error" showIcon title={changesError} />
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
                <Tooltip title="查看该文件的差异：以本提交与其父提交为两端，直接跳到该文件的对比视图">
                  <Typography.Text
                    data-testid={`changes-file-${file.path}`}
                    style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
                    ellipsis
                    onClick={() => onOpenChangedFile?.(file.path)}
                  >
                    {file.renameFrom !== undefined ? `${file.renameFrom} → ${file.path}` : file.path}
                  </Typography.Text>
                </Tooltip>
              </Flex>
            ))}
          </Flex>
        )}
      </Modal>
    </PageShell>
  );
}
