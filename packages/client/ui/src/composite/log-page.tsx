/**
 * 日志页：顶栏（仓库名 + RepoStatusBar + OperationStatus + 变更/分支/合并/贮藏/设置入口 + 「更多」下拉）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit/operation 由调用方容器注入（hooks 数据在应用层装配）。
 * 合并中（operation.kind==='merge'）时顶栏在操作条旁追加「去解决冲突」链接（onOpenConflicts 注入才渲染）。
 * 顶栏收敛：五个页面导航按钮保留为主按钮区；P3-C 只读浏览（溯源/历史/已提交/搜索）与远程相关操作
 * （拉取/推送/更新项目/远程管理）及 P3-D 四入口（补丁/搁置/控制台/忽略）及 GitHub/GitLab 面板
 * 收进「更多」Dropdown，
 * 仅在容器注入对应回调时出现对应菜单项，
 * 回调全缺省时不渲染「更多」按钮。
 * 按需加载：hasMore 为真且未在加载时，把 onLoadMore 作为 CommitGraph 的 onReachBottom 注入
 * （滚到列表底部、或已加载内容填不满视口即自动追加下一页），直到最早的一条提交进入列表；
 * 「加载更多」按钮保留为手动兜底入口。
 * 过滤行（log-filter-row）另承载两个图动作入口（设计 §2.4/§2.5/§3.5/§3.6）：
 *   · 线性折叠：「折叠/展开线性分支」按钮组。折叠状态由本页持有（唯一真源），CommitGraph 受控消费；
 *     **分支过滤激活时整组不渲染**（对齐 Java VisibleGraphImpl.isActionSupported 对 BUTTON_COLLAPSE/EXPAND
 *     返回 false → setVisible(false)，不是禁用），同时折叠状态被清空（对齐切换过滤即重建 controller）；
 *   · 分支过滤：可选项经 prop branchOptions 注入（容器经 useBranches 给），选中项放受控 filters.branches
 *     （容器据它把日志查询切到 --all，见设计 §2.2）。过滤后只显示所选分支的历史线——可见集沿父边可达
 *     故对祖先封闭，虚线过滤边（DottedFilterEdgesGenerator）在分支过滤下恒无输出（Ruling F1）；
 *     「部分分支的提交尚未加载」的降级提示是「锚点还没进来 ⇒ 图暂时空白」的兜底说明。
 * 注意：传给 CommitGraph 的 branches/collapsed 必须是**引用稳定**的数组——`filters?.branches ?? []`
 * 每次渲染都是新引用，会让图的全量布局重算在父组件每次渲染时白跑（见 EMPTY_BRANCHES）。
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
import { buildLayout, collapseAllFragments, type CollapsedFragment, type LayoutCommit } from '../graph-layout';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 空分支数组常量：受控 `filters.branches` 缺省时用它兜底。必须是指向同一个数组的常量——
 * 写成 `?? []` 会让每次渲染产生新引用，进而让 CommitGraph 的全量图布局重算在父组件每次渲染时白跑。
 */
const EMPTY_BRANCHES: string[] = [];

/** 日志过滤条件（受控：容器持有，变更即重查快照；为空时才是默认全量视图） */
export interface LogFilters {
  author?: string;
  path?: string;
  /** 分支过滤选中的分支名；非空时容器把查询切到 --all（设计 §2.2）并启用图过滤 */
  branches?: string[];
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
  /**
   * 分支过滤可选项（容器经 useBranches 注入 BranchRef.name）。缺省不渲染分支过滤入口——
   * 与「回调不注入即隐藏」的既有约定一致，避免死控件。
   */
  branchOptions?: string[];
  /** 首屏提交加载中（容器注入分页 hook 的 isLoading）：空列表时渲染加载态而不是「暂无提交」，
   *  并把「加载更多」按钮置为加载中——否则首屏拉取期间（实测可达数秒）会被误呈现成
   *  「这个仓库没有提交」+「已到最早的提交」，用户既看不出在加载、也看不出还有更早的提交 */
  initialLoading?: boolean;
  /** 还有更早的提交可加载（容器分页快照的 hasMore）；与 onLoadMore 同传时渲染「加载更多」按钮。
   *  false = 已到仓库第一条（按钮转「已到最早的提交」并禁用），此时也不再按需加载 */
  hasMore?: boolean;
  /** 「加载更多」进行中：按钮 loading 态；同时抑制按需加载（加载中不注入 onReachBottom，避免连发同页） */
  loadingMore?: boolean;
  /** 加载更早提交的回调（容器追加下一页：页大小阶梯放大 + skip 游标，直到最早一条）。
   *  滚到列表底部或已加载内容填不满视口时会自动触发它；按钮点击是同一入口的手动兜底 */
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
  branchOptions,
  hasMore,
  loadingMore,
  onLoadMore,
  initialLoading,
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
  // 折叠状态：LogPage 持有（唯一真源），CommitGraph 受控消费；工具栏按钮与图元命中共享同一份
  const [collapsed, setCollapsed] = useState<CollapsedFragment[]>([]);
  // 依赖引用必须稳定：`filters?.branches ?? []` 每次渲染都是新数组，会让 CommitGraph 的全量布局重算白跑
  const filterBranches = useMemo(() => filters?.branches ?? EMPTY_BRANCHES, [filters?.branches]);
  // 分支过滤激活 ⇒ 折叠状态清空（对齐 Java：切换过滤会重建 controller，既有折叠全部丢弃）
  useEffect(() => {
    if (filterBranches.length > 0) setCollapsed([]);
  }, [filterBranches.length]);
  // 折叠动作可用性（对齐 Java VisibleGraphImpl.isActionSupported：过滤激活时按钮不渲染）
  const collapseActionsVisible = filterBranches.length === 0;
  const expandEnabled = collapsed.length > 0;
  // 提交图区域高度：随可用空间自适应。CommitGraph 的 height 缺省是写死的 480（虚拟滚动的滚动窗口
  // 需要确定高度），窗口比 480 高时图下方留一片空白、更矮时列表溢出宿主盒子；故本页量出宿主盒子的
  // 实测高度交给它。行高/滚动窗口仍归 CommitGraph，本页只负责「这块区域有多高」。
  // 量的是**宿主元素**而不是 window：本页会被嵌进任意宿主（SplitPane 主区、独占满宽、将来的分栏/面板），
  // 视口高度与它实际能占的高度不是一回事；ResizeObserver 也顺带覆盖了「宿主被外部改高」的情形
  // （窗口 resize 只是其中一种触发源）。
  // undefined = 量不到（宿主未挂载 / jsdom 无布局 / 宿主高度为 auto），由 CommitGraph 的默认高度兜底。
  const [graphHeight, setGraphHeight] = useState<number | undefined>(undefined);
  // 观察器挂在 ref 里而不是 effect 里：宿主 div 只在「有提交」分支渲染，而首次查询回来前它是缺席的
  // （挂载时 effect 已跑过一次，且不会因 commits 到达而重跑），故用回调 ref 随挂载/卸载重新接线。
  const graphObserverRef = useRef<ResizeObserver | null>(null);
  const graphHostRef = useCallback((host: HTMLDivElement | null): void => {
    graphObserverRef.current?.disconnect();
    graphObserverRef.current = null;
    if (host === null) return;
    const measure = (): void => {
      const available = host.clientHeight;
      setGraphHeight(available > 0 ? available : undefined);
    };
    measure();
    // 无 ResizeObserver 的环境（jsdom 测试）只保留首帧这一次测量
    if (typeof ResizeObserver === 'undefined') return;
    // 宿主盒子高度变化即重测（外部改高、窗口缩放、详情面板开合、过滤行换行……）
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    graphObserverRef.current = observer;
  }, []);
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
    if (onCheckoutNewBranch !== undefined) items.push({ key: 'new-branch', label: <Tooltip title="以该提交为起点新建分支：随后弹出对话框填写分支名，确定后自动检出该分支"><span>从此处新建分支…</span></Tooltip> });
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
    // 载荷必须带上既有 filters：本函数只管 author/path 两个键，若不带上 branches，容器按
    // `f.branches ?? []` 回写就会把用户刚选好的分支过滤静默清空（查询从 --all 退回默认视图）。
    // 不做「非空才带上」的条件展开：空串就是「清空该键」的载荷（容器按 `f.author ?? ''` 处理）。
    onFiltersChange?.({ ...filters, author, path });
  };
  // 「更多」菜单项：仅装配容器注入回调的入口（P3-C 只读浏览 溯源/历史/已提交/搜索 + 本地操作 变基/标签
  // + 远程操作 拉取/推送/更新项目/远程管理 + P3-D 补丁/搁置/控制台/忽略）；全缺省时连「更多」按钮都不渲染
  const moreItems = [
    ...(onOpenBlame ? [{ key: 'blame', label: <Tooltip title="打开逐行溯源视图：查看每一行的最后修改者与提交"><span>溯源</span></Tooltip> }] : []),
    ...(onOpenHistory ? [{ key: 'history', label: <Tooltip title="打开该文件的提交历史：只看改动过它的记录"><span>历史</span></Tooltip> }] : []),
    ...(onOpenCommitted ? [{ key: 'committed', label: <Tooltip title="按提交逐条浏览已提交的变更：左侧提交列表，右侧该提交的文件目录树"><span>已提交</span></Tooltip> }] : []),
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
  // 分支过滤菜单项：本地/远程两组 + 「全选」/「清空」。用 Dropdown 的 items 承载复选态（勾选用 label 前缀 ✔ 表达，
  // 因为 antd Menu 的选中态是单选语义，不适合多选；前缀是唯一不引入自绘控件的做法）
  const branchGroups = useMemo(() => {
    const local: string[] = [];
    const remote: string[] = [];
    for (const name of branchOptions ?? []) (name.includes('/') ? remote : local).push(name);
    return { local: [...local].sort(), remote: [...remote].sort() };
  }, [branchOptions]);
  const branchFilterItems = useMemo<MenuProps['items']>(() => {
    // label 用具名 testid 的 span：antd 菜单项由 items 数据驱动，测试要点得到具体分支项，
    // 只能靠 label 里的 DOM 节点寻址（这也让「✔ 前缀」与测试锚点落在同一个节点上）
    const mark = (name: string): React.ReactNode => (
      <span data-testid={`log-branch-option-${name}`}>{filterBranches.includes(name) ? `✔ ${name}` : name}</span>
    );
    const items: NonNullable<MenuProps['items']> = [];
    if (branchGroups.local.length > 0) {
      items.push({ type: 'group', label: '本地分支', children: branchGroups.local.map((n) => ({ key: `b:${n}`, label: mark(n) })) });
    }
    if (branchGroups.remote.length > 0) {
      items.push({ type: 'group', label: '远程分支', children: branchGroups.remote.map((n) => ({ key: `b:${n}`, label: mark(n) })) });
    }
    items.push({ type: 'divider' });
    // 「全选」（设计 §3.6 动作：全选 / 清空）：把选中集置为全部可选项
    items.push({ key: 'selectAll', label: <span data-testid="log-branch-select-all">全选</span> });
    items.push({ key: 'clear', label: <span data-testid="log-branch-clear">清空</span> });
    return items;
  }, [branchGroups, filterBranches]);
  /** 分支菜单点击：`b:<name>` 取反选中项，「selectAll」全选，「clear」清空；回调载荷是完整过滤对象（容器据此切 --all 查询） */
  const onBranchFilterClick = (key: string): void => {
    if (key === 'selectAll') {
      // 全选 = 全部可选项（按 branchOptions 注入序；集合语义与顺序无关，仅保证确定）
      onFiltersChange?.({ ...filters, branches: [...(branchOptions ?? [])] });
      return;
    }
    if (key === 'clear') {
      onFiltersChange?.({ ...filters, branches: [] });
      return;
    }
    if (!key.startsWith('b:')) return;
    const name = key.slice(2);
    const next = filterBranches.includes(name) ? filterBranches.filter((n) => n !== name) : [...filterBranches, name];
    onFiltersChange?.({ ...filters, branches: next });
  };
  // 工具栏「折叠全部」用的布局输入：必须与 CommitGraph 内部那份映射（Commits → LayoutCommit）逐字一致——
  // collapseAllFragments 给出的 hash 对要能在 CommitGraph 里被 fragmentsToRows 解析到行号。
  // 两者都是纯函数、输入相同，故结果一致。
  const commitLayouts: LayoutCommit[] = useMemo(() => commits.map((c) => ({ hash: c.hash, parents: c.parents, refs: c.refs })), [commits]);
  // 主区（提交图）：与右侧详情面板共同构成两栏——宽屏并排、窄屏纵向堆叠由 SplitPane 承担。
  // 提取成变量是因为详情面板按需出现（未选中提交时整块不渲染），而 SplitPane 的侧栏宿主恒存在：
  // 把条件放进 side 会让默认视图（未选中）右侧永久留一条 320px 空列，故两栏块整体按需切换。
  // 是否允许「按需加载下一页」：还有更早的提交、当前没有请求在飞、且容器注入了加载回调。
  // 三者缺一即不注入 onReachBottom（回调节点缺省 = CommitGraph 不再触发触底加载），
  // 这也是「加载中不重复请求」的闸门——触底是持续状态，回调若一直在就会连发。
  const canLoadMore = hasMore === true && loadingMore !== true && onLoadMore !== undefined;
  const graphArea = (
    <>
      {/* 空列表：首屏还在拉取时先给加载态，只有确实加载完且为空才说「暂无提交」——
          否则首屏拉取期间（实测可达数秒）会把「在加载」误呈现成「这个仓库没有提交」 */}
      {commits.length === 0 ? (
        initialLoading === true ? (
          <Skeleton active />
        ) : (
          /* 空仓（unborn HEAD，如刚 init）与过滤无命中：显式空态——否则整片空白无法区分「在加载」与「没有提交」 */
          <EmptyState title="暂无提交" description="该仓库还没有任何提交，或当前过滤条件没有匹配结果" />
        )
      ) : (
        /* 行右键菜单（Java Vcs.Log.ContextMenu 组）：菜单项按 menuHash 组装，右键行记录 hash；
           antd Dropdown trigger=contextMenu 自动定位光标处并阻止浏览器默认菜单 */
        <Dropdown trigger={['contextMenu']} menu={{ items: menuItems, onClick: onMenuClick }}>
          {/* 宿主 div：height:100% 承接两栏布局分给它的可用空间（SplitPane 主区，或未选中提交时
              独占满宽），并把实测高度经 graphHostRef 交给 CommitGraph —— 图区高度因此随窗口与相邻
              元素自适应。刻意保留这层真实 div：下拉（右键菜单）需要一个能接 ref 的宿主节点 */}
          <div ref={graphHostRef} data-testid="log-graph-host" style={{ height: '100%' }}>
            <CommitGraph
              commits={commits}
              height={graphHeight}
              onSelect={onSelectCommit}
              onContextMenu={setMenuHash}
              showTags={showTags}
              selectedHash={selectedCommit?.hash ?? null}
              // 折叠/分支过滤三项受控 props：本页是唯一真源（工具栏按钮与图元命中改的是同一份状态）。
              // 三项都传 ⇒ 图的交互面（图元点击折叠、虚线边展开、悬停链高亮）才真正激活；
              // 过滤态下 branches 非空，图内 graphActionsEnabled=false，高亮与折叠一并失效（Java 语义，勿解耦）
              branches={filterBranches}
              collapsed={collapsed}
              onCollapseChange={setCollapsed}
              // 按需加载：滚到列表底部（或内容还填不满视口）时自动追加下一页，直到最早的一条进来。
              // 正在加载时不注入（回调缺省即不再触发）——避免同一页被连点/触底撞出两次请求
              {...(canLoadMore ? { onReachBottom: onLoadMore } : {})}
            />
          </div>
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
          1) Row/Col 从 'antd' 顶层具名导入；`Grid` 这个具名导出在 antd 6.6.3 运行时只有 useBreakpoint
             （`es/grid/index.js` 只 default 出 { useBreakpoint }，Col/Row 是**具名**导出），在它上面解构 Row/Col 会拿到 undefined。
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
            {/* minWidth:0 让长仓库名可被压缩并走 ellipsis，而不是把右端操作挤出屏幕；行内边距与字号交 antd（原手写 padding/fontWeight） */}
            <Typography.Text strong ellipsis={{ tooltip: repoName }} style={{ minWidth: 0 }}>
              {repoName}
            </Typography.Text>
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
                    size="small"
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
                  size="small"
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
                  size="small"
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
                  size="small"
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
                  size="small"
                  icon={<InboxOutlined />}
                  onClick={onOpenStashes}
                />
              </Tooltip>
            ) : null}
            {/* 设置入口 */}
            {onOpenSettings ? (
              <Tooltip title="打开仓库设置：该仓库的 git 配置（local）与 GPG 提交签名（应用级项在首页「设置」）">
                <Button
                  aria-label="设置"
                  type="text"
                  size="small"
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
                  <Button aria-label="更多" type="text" size="small" icon={<MoreOutlined />} />
                </Tooltip>
              </Dropdown>
            ) : null}
          </Space>
        </Col>
      </Row>
      {/* 过滤/分页行：仅容器同时注入过滤回调时渲染（过滤受控，Enter/失焦提交防每击键重查）；
          容器只做「横排 + token 分隔线」的布局宿主，行内边距交页面栅格（不手调）；
          窄屏（≤768）允许换行，避免输入框/开关被压成竖排文字 */}
      {onFiltersChange !== undefined ? (
        <div
          data-testid="log-filter-row"
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: `1px solid ${token.colorSplit}` }}
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
            <Typography.Text type="secondary">
              标签
            </Typography.Text>
          </Flex>
          {/* 线性折叠（Java Collapse/Expand Linear Branches）：过滤激活时整组不渲染——
              对齐 VisibleGraphImpl.isActionSupported 对 BUTTON_COLLAPSE/BUTTON_EXPAND 返回
              `graphController !is FilteredController`（过滤态下 setVisible(false)，不是禁用） */}
          {collapseActionsVisible ? (
            <>
              <Tooltip title="折叠线性分支：把无分叉的连续提交折成一条虚线（点虚线可展开）">
                <Button
                  size="small"
                  data-testid="log-collapse-all"
                  disabled={commits.length === 0}
                  onClick={() => setCollapsed(collapseAllFragments(buildLayout(commitLayouts)))}
                >
                  折叠线性分支
                </Button>
              </Tooltip>
              <Tooltip title="展开线性分支：恢复所有被折叠的提交与连线">
                {/* 首次进页面该按钮恒禁用（无折叠），而禁用元素不派发 hover、Tooltip 永不显示：
                    同「加载更多」做法，在 Tooltip 与 Button 之间包一层 span 承接悬停 */}
                <span>
                  <Button
                    size="small"
                    data-testid="log-expand-all"
                    disabled={!expandEnabled}
                    onClick={() => setCollapsed([])}
                  >
                    展开线性分支
                  </Button>
                </span>
              </Tooltip>
            </>
          ) : null}
          {/* 分支过滤弹窗：仅容器同时注入可选项与过滤回调时渲染 */}
          {branchOptions !== undefined && branchOptions.length > 0 && onFiltersChange !== undefined ? (
            <Dropdown
              trigger={['click']}
              menu={{ items: branchFilterItems, onClick: ({ key }) => onBranchFilterClick(key) }}
            >
              <Tooltip title="按分支过滤提交图：只保留所选分支可达的提交，其余提交不显示">
                <Button size="small" data-testid="log-branch-filter">
                  分支过滤{filterBranches.length > 0 ? `（${filterBranches.length}）` : ''}
                </Button>
              </Tooltip>
            </Dropdown>
          ) : null}
          {/* 降级提示（设计 §7 风险 1）：过滤激活时数据源是 --all 且仍可分页，某个选中分支的 tip
              可能尚未加载 —— 此时它会暂时不可见。按需加载会继续追加直到最早一条，故这里只作说明，
              不做「无匹配」之类的断言（那会把「还在加载」说成「没有」）。
              判据用 hasMore（还有更早的提交没进来）而不是精确的可见行数：精确值只有 CommitGraph 内部
              算得出，为了一个提示在 LogPage 再跑一遍全量布局不值当。 */}
          {filterBranches.length > 0 && hasMore === true ? (
            <Typography.Text type="secondary" data-testid="log-branch-filter-hint">
              部分分支的提交尚未加载，将继续加载
            </Typography.Text>
          ) : null}
          {hasMore !== undefined && onLoadMore !== undefined ? (
            // 没有更早的提交（已到仓库第一条）时按钮禁用；禁用按钮不派发 hover，故在 Tooltip 与 Button
            // 之间包 span 承接悬停。外层 span 承接原先挂在按钮上的 marginLeft:auto（按钮自身 style 不变），
            // 右对齐位置不变。这只是「手动兜底」入口：正常路径是滚到列表底部自动按需加载（见 onReachBottom）。
            // 首屏加载中（initialLoading）：hasMore 此刻还是未知（false 只表示「还没有数据」），
            // 故按钮呈加载中且不宣称「已到最早的提交」——否则会把「还在拉第一页」说成「历史看完了」
            <Tooltip title={initialLoading === true ? '正在加载提交记录…' : hasMore ? '继续加载更早的提交：滚到列表底部会自动加载，也可以点这里手动加载；结果追加在列表下方' : '已到最早的提交：该仓库的全部提交都已加载（含第一条）'}>
              <span style={{ marginLeft: 'auto' }}>
                <Button
                  size="small"
                  data-testid="log-load-more"
                  disabled={initialLoading === true || !hasMore}
                  loading={initialLoading === true || loadingMore}
                  onClick={onLoadMore}
                >
                  {initialLoading === true || hasMore ? '加载更多' : '已到最早的提交'}
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
               宽度 320 / flexShrink:0 / 内部滚动均已由 SplitPane 的侧栏宿主承担，此处不再重复。
               minHeight:100% 让这层盒子至少撑满侧栏宿主（分隔线因此对齐整栏高度，而不是只画到
               提交信息的高度为止）；用 minHeight 而非 height：详情内容比一栏更高时盒子随之长高，
               线仍覆盖全部内容，不会在滚动到底部后中断 */
            <div data-testid="commit-details" style={{ minHeight: '100%', borderLeft: `1px solid ${token.colorSplit}` }}>
              <CommitDetailsPanel
                commit={selectedCommit}
                onResetHere={onResetHere}
                onCherryPick={onCherryPick}
                onRevert={onRevert}
                onBrowse={onBrowse}
                onOpenChanges={onOpenChanges}
                onSelectCommit={onSelectCommit}
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
        // 只有一个「关闭」键：走 footer 语义（同 stash-panel），不再用内联样式藏取消键
        footer={(_, { OkBtn }) => <OkBtn />}
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
            <Typography.Text type="secondary">
              {changesEntry.subject}
            </Typography.Text>
            {changesEntry.files.map((file) => (
              <Flex key={`${file.status}-${file.path}`} align="center" gap={8}>
                <CommittedStatusTag status={file.status} />
                <Tooltip title="查看该文件的差异（新标签页打开，本弹窗留在变更集上）：以本提交与其父提交为两端">
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
