/**
 * 日志页：顶栏（抽为共用组件 RepoTopNav：**面包屑「首页 / 仓库名」** + RepoStatusBar + OperationStatus + 日志/变更/分支/合并/贮藏/设置入口 + 「更多」下拉）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit/operation 由调用方容器注入（hooks 数据在应用层装配）。
 * 合并中（operation.kind==='merge'）时顶栏在操作条旁追加「去解决冲突」链接（onOpenConflicts 注入才渲染）。
 * 顶栏收敛：页面导航按钮（日志/变更/分支/合并/贮藏/设置）为主按钮区；P3-C 只读浏览（溯源/历史/搜索）与远程相关操作
 * （拉取/推送/更新项目/远程管理）及 P3-D 四入口（补丁/搁置/控制台/忽略）及 GitHub/GitLab 面板
 * 收进「更多」Dropdown（以上均在 RepoTopNav 内装配），
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
import { Button, Dropdown, Flex, Input, Modal, Skeleton, Switch, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import type { BrowseContent, BrowseEntry, CommitInfo, CommittedEntry, FileVersions, OperationState, RepoStatus } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { PageShell } from '../base/page-shell';
import { ResizableColumns, restoreWidthsToAvailable, type ResizablePane } from '../base/resizable-columns';
import { SplitPane } from '../base/split-pane';
import { FALLBACK_CHAR_WIDTH } from '../base/readonly-text-view';
import { copyToClipboard } from '../base/clipboard';
import { CommitGraph } from '../domain/commit-graph';
import { CommitDetailsPanel } from '../domain/commit-details-panel';
import { SnapshotTabs } from './snapshot-tabs';
import { RepoTopNav } from './repo-top-nav';
import { buildLayout, collapseAllFragments, type CollapsedFragment, type LayoutCommit } from '../graph-layout';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 空分支数组常量：受控 `filters.branches` 缺省时用它兜底。必须是指向同一个数组的常量——
 * 写成 `?? []` 会让每次渲染产生新引用，进而让 CommitGraph 的全量图布局重算在父组件每次渲染时白跑。
 */
const EMPTY_BRANCHES: string[] = [];

/* === 就地快照栏（浏览快照）的列宽契约 ===
 * 三栏：提交日志 | 提交详情 | 快照（文件树与文件内容已合并为**一条标签栏**，见 composite/snapshot-tabs）。
 * 下面这些数字是**初值与夹紧范围**，不是写死的宽度——用户拖过之后以用户值为准（见 useStoredWidth）。 */
/**
 * 三列（提交日志 / 提交详情 / 快照）的**统一拖拽下限**（用户口径：都改成 80px）。
 * 注意 80px 是「还能拖到多窄」的硬下限，不是默认宽度——默认宽度仍是各列自己的 default。
 * 详情面板在 80px 下按钮会换行、文字会省略，属可接受的极端态（用户明确要求这个下限）。
 */
const MIN_COLUMN_PX = 80;
/** 提交日志栏：弹性（吃剩余），但被压到这个下限就不再让位（用户口径：与详情/快照统一为 80px） */
const LOG_MIN_WIDTH = MIN_COLUMN_PX;
/**
 * 日志栏的「希望宽度」：它实际多宽由 base/resizable-columns 按容器实测宽度反算（原语才知道容器多宽），
 * 此处只给一个足够大的值让它在正常窗口下不被压缩。**不落库**——弹性列的绝对宽存下来换个窗口就失配。
 */
const LOG_WISH_WIDTH = 900;
/** 详情面板默认/夹紧宽度：340 是既有 320 放不下「Reset 当前分支到此处」一行的问题宽度 */
const DETAILS_WIDTH = {
  default: 340,
  min: MIN_COLUMN_PX,
  max: 560,
  /** 展开快照栏时自动收到的宽度（用户口径：不能更小、可任意更大） */
  whenBrowsing: 320,
};
/** 快照栏默认宽度（字符数）：沿用原「文件内容栏 100 字符」的观感，换到标签页后正文宽度不变 */
const SNAPSHOT_DEFAULT_CHARS = 100;
/**
 * 快照栏的**拖拽下限**（px）：仅保证不塌成 0，往上不设限（用户口径「文件内容区域的拖拽不要有限制」）。
 * 语义从「至少 70 字符」放宽到「约 30 字符」——70 字符那条下限（≈548px）会吃掉三栏预算的三分之一，
 * 日志栏因此被挤得只剩一两行宽，正文本身可横向滚动，故窄一点只是要多滚。
 */
const SNAPSHOT_MIN_PX = 240;
/** 快照栏宽度上限（px）：再高也只是多留白，反而把日志栏挤没 */
const SNAPSHOT_MAX_WIDTH = 1200;

/**
 * 列宽记忆：把用户拖出来的宽度存进 localStorage，跨刷新与面板开合保留。
 * 为什么不是「仅本次会话」：调列宽是**一次性的个人偏好**，刷新就回默认等于每次都要重调一遍。
 * 读写都夹紧：存量值可能来自旧版本的范围、也可能被手改过，越界一律夹回，不让它把布局撑坏。
 */
function useStoredWidth(key: string, def: number, min: number, max: number): [number, (next: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return def;
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : def;
    } catch {
      // 隐私模式/禁用存储：读不到就用默认值，不影响功能
      return def;
    }
  });
  const update = useCallback(
    (next: number) => {
      const clamped = Math.min(max, Math.max(min, Math.round(next)));
      setWidth(clamped);
      try {
        window.localStorage.setItem(key, String(clamped));
      } catch {
        // 写不进去（配额/禁用）：本次会话内的宽度仍然生效
      }
    },
    [key, min, max],
  );
  return [width, update];
}

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
  /** 日志页入口回调（顶栏「日志」按钮，跨页导航回本页用）；缺省不渲染该按钮 */
  onOpenLog?: () => void;
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
  /** 透传给 CommitDetailsPanel 的「浏览快照」回调（选中提交 → 打开/收起就地快照栏）；缺省详情面板不渲染该按钮 */
  onBrowse?: (hash: string) => void;
  /**
   * 「浏览快照」开关（受控，真源在容器：URL 的 `browse=1`）：为真时右栏里出现**文件树那一族**标签
   * （「文件（N）」文件树 + 树里点开的文件内容标签）。与变更集开关（`changesHash` 非空）**互不代劳**——
   * 只开变更集时右栏照样出现，只是没有文件树标签（见下面布局分支）。
   * 缺省 false：布局与未引入快照栏之前逐像素一致（两栏：日志 + 详情）。
   */
  browseOpen?: boolean;
  /** 快照栏的目标版本（只作**标签栏重挂载键**：换版本即复位已打开的文件标签；不再展示短名） */
  browseRev?: string;
  /** 该版本的平铺文件条目（容器经 useBrowseTree 拉取） */
  browseEntries?: BrowseEntry[];
  /** 文件树加载中 */
  browseLoading?: boolean;
  /** 文件树错误信息 */
  browseError?: string;
  /** 当前选中文件路径（受控；对应的标签页由快照标签栏打开并激活） */
  browseSelectedPath?: string;
  /** 选中文件内容（容器经 useBrowseContent 拉取；只给当前选中的那一份） */
  browseContent?: BrowseContent;
  /** 文件内容加载中 */
  browseContentLoading?: boolean;
  /** 文件内容错误信息 */
  browseContentError?: string;
  /** 树里点文件：路径相同 = 收起内容（容器据此清空选中）；目录不触发（FileTree 只对叶子回调）。
   *  快照标签栏切/关标签也走这条回调（换文件传新路径；回文件树传当前路径即收起）。 */
  onSelectBrowseFile?: (path: string) => void;
  /** 透传给 CommitDetailsPanel 的「查看变更集」回调（#13 LogPage → 变更集标签：开/关该提交的变更集标签）；缺省不渲染该按钮 */
  onOpenChanges?: (hash: string) => void;
  /**
   * 变更集标签受控打开键（容器经 useCommitFiles 条件拉取；'' = 没有该标签）。
   * 它同时就是「查看变更集」这个开关的**开合真源**（容器由 URL 的 `diff=1` 派生）：非空 → 右栏出现
   * 「变更集（N）」标签与差异标签，空 → 那一族整族不存在。与 browseOpen **互不代劳**，
   * 但两者**共用一条右栏**——任一为「开」即渲染右栏（见下面布局分支）。
   */
  changesHash?: string;
  /** 变更集标签数据（容器条件拉取；null 未就绪 → 加载态） */
  changesEntry?: CommittedEntry | null;
  /** 变更集拉取中 */
  changesLoading?: boolean;
  /** 变更集拉取错误信息 */
  changesError?: string | null;
  /** 变更集标签开着（且就是这个提交）：详情面板按钮呈开关的「开」态 */
  changesActive?: boolean;
  /** 关闭变更集标签（容器清空 hash 并收起该族差异标签） */
  onCloseChanges?: () => void;

  /** 变更集清单里点某个文件（#13：容器把它开成快照栏里的差异标签，from=父提交、to=该提交） */
  onOpenChangedFile?: (path: string) => void;
  /** 差异标签族（受控，容器持有：换提交重挂载标签栏后仍存活，并按新提交变更集剪枝） */
  changesDiff?: { open: string[]; active: string };
  /** 差异标签族变化（切/关标签） */
  onChangesDiffChange?: (next: { open: string[]; active: string }) => void;
  /** 当前激活差异文件的两版全文（容器经 useFileDiff 只给这一份） */
  changesDiffVersions?: FileVersions;
  /** 当前激活差异拉取中 */
  changesDiffLoading?: boolean;
  /** 当前激活差异错误信息 */
  changesDiffError?: string;
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
  onOpenLog,
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
  browseOpen,
  browseRev,
  browseEntries,
  browseLoading,
  browseError,
  browseSelectedPath,
  browseContent,
  browseContentLoading,
  browseContentError,
  onSelectBrowseFile,
  onOpenChanges,
  changesHash,
  changesEntry,
  changesLoading,
  changesError,
  changesActive,
  onCloseChanges,
  onOpenChangedFile,
  changesDiff,
  onChangesDiffChange,
  changesDiffVersions,
  changesDiffLoading,
  changesDiffError,
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
  const canLoadMore = hasMore === true && loadingMore !== true && onLoadMore !== undefined;  // === 就地快照栏的三栏宽度 ===
  // 两栏（详情/快照）的宽度是**用户偏好**，落 localStorage；日志栏是弹性列——它的宽度恒等于
  // 「容器实测宽 − 其余两栏 − 两条分隔条」，故它既不落库（绝对宽换个窗口就失配）、也不参与拖拽
  // （用户永远不会把它拖成把别的栏挤出屏幕的宽度）。容器实测宽由原语经 onAvailableChange 上报，
  // 拿到后把偏好**按比例还原**到当前可用宽（见 restoreWidthsToAvailable）。
  const [detailsPref, setDetailsPref] = useStoredWidth('rebased.log.detailsWidth', DETAILS_WIDTH.default, DETAILS_WIDTH.min, DETAILS_WIDTH.max);
  /* 快照栏默认宽按**字符数**折算成像素（首帧/jsdom 量不到实测字符宽，故直接用兜底常量，
     无需异步等待）。localStorage 键沿用合栏前的 `rebased.log.contentWidth`：它一直是
     「这一栏多宽」这一个偏好，键名没变就等于老用户的宽度设置原样继承（改名只会让所有人的栏宽悄悄回到默认）。 */
  const snapshotDefaultWidth = Math.round(SNAPSHOT_DEFAULT_CHARS * FALLBACK_CHAR_WIDTH);
  const [snapshotPref, setSnapshotPref] = useStoredWidth(
    'rebased.log.contentWidth',
    snapshotDefaultWidth,
    SNAPSHOT_MIN_PX,
    Math.max(SNAPSHOT_MAX_WIDTH, snapshotDefaultWidth),
  );
  // 容器实测宽度（原语经 onAvailableChange 上报）：首帧为 0（还没量到），此时按偏好原样渲染，
  // 量到之后触发一次按比例的还原。
  const [columnsAvailable, setColumnsAvailable] = useState(0);
  /** 复制全文的一次性反馈（按钮在文件标签的路径栏、文案在正文区，故状态由本页持有）；到期清空，避免常驻 */
  const [snapshotCopyHint, setSnapshotCopyHint] = useState<string | null>(null);
  const copyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyHintTimerRef.current !== null) clearTimeout(copyHintTimerRef.current);
  }, []);
  const onCopyBrowseContent = (): void => {
    void copyToClipboard(browseContent?.content ?? '').then((ok) => {
      setSnapshotCopyHint(ok ? '已复制全文' : '复制失败：浏览器未授予剪贴板权限');
      if (copyHintTimerRef.current !== null) clearTimeout(copyHintTimerRef.current);
      copyHintTimerRef.current = setTimeout(() => setSnapshotCopyHint(null), 1500);
    });
  };
  // 几何契约（不含内容）——还原宽度要用 min/max/默认值，与下方渲染用的是同一份。
  // 日志栏标 flexible：它的宽度由 Splitter 补剩余空间（**不给 `size`**），故它的 width 值不参与计算
  // 打开快照时把「提交日志」与「提交详情」**自动收到 320**（不更小；用户仍可手动拖更大）：
  //   · 详情栏是固定宽的栏，直接把它设到 320；
  //   · 日志栏是弹性列（宽度 = 可用宽 − 其余各栏），把详情收到 320 后它自然跟着收窄，无需另设。
  // 只在**打开的那一刻**收（依赖 browseOpen 的翻转），不是每次渲染都压回去——
  // 否则用户手动拖宽日志栏会被下一次渲染立刻抹掉。
  const shrinkRequestedRef = useRef(false);
  useEffect(() => {
    if (browseOpen !== true) {
      shrinkRequestedRef.current = false;
      return;
    }
    if (shrinkRequestedRef.current) return;
    shrinkRequestedRef.current = true;
    setDetailsPref(DETAILS_WIDTH.whenBrowsing);
  }, [browseOpen, setDetailsPref]);
  const widthPanes: Pick<ResizablePane, 'key' | 'width' | 'min' | 'max' | 'flexible'>[] = [
    { key: 'log', width: 0, min: LOG_MIN_WIDTH, max: Number.MAX_SAFE_INTEGER, flexible: true },
    { key: 'details', width: detailsPref, min: DETAILS_WIDTH.min, max: DETAILS_WIDTH.max },
    { key: 'snapshot', width: snapshotPref, min: SNAPSHOT_MIN_PX, max: Math.max(SNAPSHOT_MAX_WIDTH, snapshotDefaultWidth) },
  ];
  // 偏好 → 当前可用宽下的实际宽度：够宽时原样，不够时按比例（栏间观感保持不变）
  const paneWidths = restoreWidthsToAvailable(
    widthPanes.map((p) => p.width),
    widthPanes,
    columnsAvailable,
    widthPanes.length - 1,
  );
  /**
   * 两条分隔条拖完后的宽度回写。
   * **按 key 定位，不能按下标**：栏数会随「是否展开快照栏」在 2 与 3 之间切换，`next` 的**下标会整体前移**。
   * 早先按下标解构（`const [, nextDetails, nextTree, nextContent] = next`），栏数变化时宽度会被写进**别的栏**的
   * 偏好里（内容宽度污染树的偏好），而对应的偏好永不更新、每帧被 `restoreWidthsToAvailable` 按旧值重算，
   * 拖动时相邻两栏就一起晃（实测 log 497→461、details 320→385、content 783→754）。
   */
  const onPaneWidthsChange = (next: number[]): void => {
    // 下标 → key 的映射按**当前实际渲染的栏序**取（与传给 Splitter 的 panes 同源），故栏的增删不会错位
    const orderedKeys = renderedPaneKeys.current;
    for (let i = 0; i < next.length; i++) {
      const key = orderedKeys[i];
      const width = next[i];
      if (key === undefined || width === undefined || !Number.isFinite(width)) continue;
      if (key === 'details' && width !== detailsPref) setDetailsPref(width);
      else if (key === 'snapshot' && width !== snapshotPref) setSnapshotPref(width);
      // 日志栏（弹性列）的宽度由可用宽与其余各栏决定，**刻意丢弃**
    }
  };
  /** 当前渲染的栏序（键名）：在下方构造 panes 时写入，供拖动回写按下标查 key */
  const renderedPaneKeys = useRef<string[]>([]);
  const graphArea = (    <>
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
            // 作者/日期两列**始终显示**（2026-09-20 用户口径：删除隐藏策略）：
            // 此前按本栏实测宽度 ≥ 512 决定整列显隐，现在没有开关，空间不足由省略号承接。
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
  // 选中提交：三元分支里的收窄传不进 JSX 数组字面量（TS 在回调/数组元素里会重新读取 props 类型），
  // 故显式断言一次。注意 selectedCommit 是**可选** prop：未传时是 undefined 而不是 null，
  // 判空必须用真值判断（下方三元即为真值判断）——写成 `=== null` 会把 undefined 直接送进详情面板，
  // 实测整页在 CommitDetailsPanel 读 commit.refs 时崩溃（81 个既有用例同时红）。
  const activeCommit = selectedCommit as CommitInfo | null | undefined;
  // 页面根：PageShell 自带纵向 Flex + width:100% + minWidth:0 + height:100%（并施加紧凑密度）。
  // LogPage 是路由根（两端容器均以裸 fragment 直接渲染它），故密度归本页所有——不传 density 即默认 compact。
  // 原根节点既无 gap 也无 padding，故这里都不传（PageShell 默认不落 style，传了会凭空新增间距）。
  return (
    <PageShell>
      {/* 顶栏：抽为共用组件 RepoTopNav（除欢迎屏外的所有仓库页共用，见 composite/repo-top-nav.tsx）。
          本页注入日志页专属内容（状态条/操作条/撤销最近提交/「去解决冲突」）与对话框类「更多」项（拉取/推送/更新项目/变基），
          current 固定为 'log'——日志图标高亮。布局细节（两端分布/面包屑/图标按钮）的口径见该组件注释。 */}
      <RepoTopNav
        repoName={repoName}
        current="log"
        status={status}
        operation={operation}
        onAbortOperation={onAbortOperation}
        abortingOperation={abortingOperation}
        onUndoCommit={onUndoCommit}
        undoCommitting={undoCommitting}
        onGoHome={onGoHome}
        onOpenLog={onOpenLog}
        onOpenStatus={onOpenStatus}
        onOpenBranches={onOpenBranches}
        onOpenMerge={onOpenMerge}
        onOpenStashes={onOpenStashes}
        onOpenSettings={onOpenSettings}
        onOpenPull={onOpenPull}
        onOpenPush={onOpenPush}
        onOpenUpdate={onOpenUpdate}
        onOpenRemotes={onOpenRemotes}
        onOpenRebase={onOpenRebase}
        onOpenTags={onOpenTags}
        onOpenConflicts={onOpenConflicts}
        onOpenBlame={onOpenBlame}
        onOpenHistory={onOpenHistory}
        onOpenSearch={onOpenSearch}
        onOpenPatches={onOpenPatches}
        onOpenShelves={onOpenShelves}
        onOpenConsole={onOpenConsole}
        onOpenIgnore={onOpenIgnore}
        onOpenGithub={onOpenGithub}
        githubAvailable={githubAvailable}
        onOpenGitlab={onOpenGitlab}
        gitlabAvailable={gitlabAvailable}
        onOpenWorktrees={onOpenWorktrees}
        onOpenSubmodules={onOpenSubmodules}
      />
      {/* 过滤/分页行：仅容器同时注入过滤回调时渲染（过滤受控，Enter/失焦提交防每击键重查）；
          容器只做「横排 + token 分隔线」的布局宿主，行内边距交页面栅格（不手调）；
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
      {/* 两栏/三栏：主区（提交图）+ 右侧详情面板；任一开关（浏览快照 / 查看变更集）打开时插入**快照栏**。
          快照栏 = 两个功能共用的**标签栏**（composite/snapshot-tabs）：
          「浏览快照」开 → 有「文件（N）」文件树标签，树里点开的文件各占一个内容标签；
          「查看变更集」开 → 有「变更集（N）」标签，清单里点开的文件各占一个差异标签。两族各由自己的开关显隐。
          列宽：两条分隔条各调整其**左邻**那一栏（日志 | 详情 | 快照），详情/快照的宽度记 localStorage；
          日志栏是弹性列，实际宽由原语按容器宽反算（见 LOG_WISH_WIDTH 与 base/resizable-columns）。
          未选中提交时退化为主区独占满宽（盒子几何与 SplitPane 的主区宿主一致）。 */}
      {/* 两栏/三栏形态：
            · 未选中提交 → 主区独占满宽；
            · 选中但两个开关都关 → 两栏：日志主区 + 详情侧栏（antd Splitter）；
            · 选中且任一开关打开 → 三栏：日志 | 详情 | 快照（其内按开关决定有哪几族标签）。
          作者/日期两列**始终显示**（2026-09-20 用户口径：删除按栏宽显隐），与两个开关无关。 */}
      {activeCommit === null || activeCommit === undefined ? (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>{graphArea}</div>
      ) : (() => {
        // 收窄一次类型：下面各分支都在「已选中提交」的前提下，故这里把它固化成非空常量
        const commit = activeCommit;
        /** 提交详情栏：两个分支共用（同一个提交、同一份回调），故只写一次 */
        const detailsPanel = (
          <CommitDetailsPanel
            commit={commit}
            onResetHere={onResetHere}
            onCherryPick={onCherryPick}
            onRevert={onRevert}
            onBrowse={onBrowse}
            // 「浏览快照」按钮的选中态跟**自己的开关**走（不再恒真——右栏也可能是只开了变更集）
            browseActive={browseOpen === true}
            onOpenChanges={onOpenChanges}
            changesActive={changesActive === true}
            onSelectCommit={onSelectCommit}
            data-testid="commit-details"
            style={{ minHeight: '100%' }}
          />
        );
        /** 快照栏（两个功能共用的标签栏）：显隐由两个开关各自传给 SnapshotTabs，这里只管装配 */
        const snapshotPane = (
          <SnapshotTabs
            /* key = 版本：换提交即重挂载标签区（旧标签的路径在新版本里未必存在，
               沿用容器 onSelectCommit「换版本就清空 ?file=」的既有口径），展开态随之回到文件树 */
            key={browseRev ?? ''}
            // 「浏览快照」开关：关着时栏内不出现文件树那一族标签（与下面变更集那一族互不代劳）
            browseTree={browseOpen === true}
            entries={browseEntries}
            loading={browseLoading}
            error={browseError}
            selectedPath={browseSelectedPath}
            content={browseContent}
            contentLoading={browseContentLoading}
            contentError={browseContentError}
            onSelectFile={onSelectBrowseFile}
            /* 切/关标签 → 容器改选中：换文件就写新的 ?file=；回文件树就用既有 toggle 语义清空
               （容器约定：同路径再点即收起，见 onSelectBrowseFile 的 props 注释），
               故这里不必给容器加新契约。 */
            onActivateTab={(path) => {
              if (path === null) {
                if (browseSelectedPath !== undefined) onSelectBrowseFile?.(browseSelectedPath);
              } else if (path !== browseSelectedPath) onSelectBrowseFile?.(path);
            }}
            onCopyAll={onCopyBrowseContent}
            copyHint={snapshotCopyHint}
            /* 变更集（#13）：Modal 已改为标签栏里的一个标签——「查看变更集」开着且该提交有 hash 时出现
               「变更集（N）」标签，点清单里的文件在同一栏开它的差异标签（容器持有 open/active） */
            changeset={
              changesHash === undefined || changesHash === ''
                ? null
                : { entry: changesEntry, loading: changesLoading, error: changesError }
            }
            onCloseChangeset={onCloseChanges}
            onOpenChangedFile={onOpenChangedFile}
            diffTabs={changesDiff}
            onDiffTabsChange={onChangesDiffChange}
            diffVersions={changesDiffVersions}
            diffLoading={changesDiffLoading}
            diffError={changesDiffError}
          />
        );
        // 两个开关都关（浏览快照关 + 变更集无 hash）：右栏不渲染，回到两栏
        if (browseOpen !== true && (changesHash === undefined || changesHash === '')) {
          return (
            <SplitPane
              sidePosition="end"
              sideWidth={detailsPref}
              side={<div style={{ minHeight: '100%', padding: 8, overflow: 'auto' }}>{detailsPanel}</div>}
            >
              {graphArea}
            </SplitPane>
          );
        }
        renderedPaneKeys.current = ['log', 'details', 'snapshot'];
        const panes: ResizablePane[] = [
          {
            key: 'log',
            label: '提交日志',
            content: graphArea,
            width: 0,
            min: DETAILS_WIDTH.min,
            max: Number.MAX_SAFE_INTEGER,
            flexible: true,
          },
          {
            key: 'details',
            label: '提交详情',
            content: detailsPanel,
            width: paneWidths[1] ?? detailsPref,
            min: DETAILS_WIDTH.min,
            max: Number.MAX_SAFE_INTEGER,
            /* 详情栏是**可长内容**（提交正文、分支/tag chips、操作按钮换行），必须自己滚：
               原语宿主的默认 `overflow: hidden` 会把它裁掉——实测正文长的提交看不到底部内容、
               也没有任何滚动条（提交详情溢出缺陷）。这里覆写为 `auto` + 留一点内边距。
               内边距给宿主而不是给面板：面板的 padding 已被用户口径改成 0（贴边），
               故留白归栏宿主，面板自身保持 padding: 0。 */
            style: { overflow: 'auto', padding: 8 },
          },
          {
            key: 'snapshot',
            label: '快照',
            content: snapshotPane,
            width: paneWidths[2] ?? snapshotPref,
            min: SNAPSHOT_MIN_PX,
            max: Number.MAX_SAFE_INTEGER,
            style: { padding: 0 },
          },
        ];
        return (
          <ResizableColumns
            onWidthsChange={onPaneWidthsChange}
            onAvailableChange={setColumnsAvailable}
            panes={panes}
          />
        );
      })()}
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
    </PageShell>
  );
}
