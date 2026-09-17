/**
 * 快照标签页：把「文件树」「变更集」「文件内容」「变更差异」合并成**一条标签栏**（对齐编辑器式浏览）。
 * 做什么：第一个标签是「文件（N）」（内是文件树，不可关闭）；有变更集时第二个标签是「变更集（N）」
 *        （内是本次提交的变更文件清单，可关闭）；树里每点一个文件把它开成一个可关闭的内容标签；
 *        变更集里每点一个文件把它开成一个可关闭的差异标签。正文都渲染在标签页内。
 *        标签栏右端**不再挂版本短名 chip**（用户口径删除）：当前在看哪一版由容器给的提交上下文表达。
 * 为什么合并：两栏并排时文件树恒占一栏宽，宽屏下等于白吃一块正文宽度，且「这是哪一版 / 在看哪个文件」
 *        被拆在两个表头里；合并后同一时刻只显示一份内容，宽度全给正文。
 * 状态归属（两族，刻意不同）：
 *   · 文件内容标签（openPaths / 激活键 / 内容副本）是**本组件的视图状态**，内容真源仍是容器的 `?file=`；
 *     selectedPath 变化时对齐一次（深链、换提交、容器清空），用户切/关标签则先本地生效，
 *     再经 onActivateTab 通知容器回写 URL（容器慢一拍也不会把用户弹回原标签）。
 *   · 变更集与差异标签**由容器持有**（changeset / diffTabs）：它们要跨「换提交时本组件被 key 重挂载」存活，
 *     而那次重挂载正是文件树内容标签的复位手段（旧路径在新版本里未必存在）。容器按新提交的变更集剪枝
 *     已开差异标签，并在数据到位后把激活项回报过来。
 * 两族标签的显隐各由一个开关决定，互不代劳（用户口径 2026-09-17）：
 *   · `browseTree`（缺省 true）= 详情面板「浏览快照」；为假时**没有**「文件（N）」标签与文件内容标签，
 *     整条标签栏只剩变更集那一族；
 *   · `changeset` 非空 = 详情面板「查看变更集」；为 null/缺省时没有「变更集（N）」标签与差异标签。
 * 两个都关时标签栏是空的——调用方（LogPage）据此不渲染右栏，本组件只保证不凭空冒出标签。
 * 激活优先（挂载那一刻，也是换提交重挂载后的落点）：容器指定的差异标签 → 容器选中的文件标签 →
 *        变更集标签（开着的话）→ 文件树。挂载之后只对**变化**做对齐（见下面各处 synced ref），
 *        不每帧以容器为准——否则用户刚点的标签会被容器那拍还没落地的状态当场弹回。
 * 内容副本：容器只给「当前激活文件/差异」那一份内容，故这里按路径各留一份副本：切回已访问的标签立即出内容、
 *        编辑器实例不重建（滚动位置不丢），激活标签在容器重新拉取期间也先用副本显示（同 SWR 的观感）。
 * 标签键空间（四族天然不相交，撞键会真的出问题）：「文件」= files；文件内容 = path:<路径>；
 *        变更集 = changeset；差异 = diff:<路径>。路径之间本来就唯一，前缀隔离的是「根目录真有个叫
 *        files 的文件」这类与固定标签重名的路径（React 重复 key + 点文件名被当成点固定标签）。
 * 纯展示：不调接口、不碰 URL，全部经回调上抛。
 */
import { FolderOutlined } from '@ant-design/icons';
import { Flex, Tabs, Tooltip, Typography, theme } from 'antd';
import type { TabsProps } from 'antd';
import type { BrowseContent, BrowseEntry, CommittedEntry, FileVersions } from '@rebased/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';
import { EmptyState } from '../base/empty-state';
import { ReadonlyTextView, ReadonlyTextActions } from '../base/readonly-text-view';
import { ChangesetDiffPane, ChangesetList } from './changeset-pane';
import { SnapshotTreeColumn } from './snapshot-tree-column';

/** 「文件」标签的键：树所在的那一个标签页 */
export const SNAPSHOT_TREE_TAB_KEY = 'files';
/** 「变更集」标签的键：本次提交的变更文件清单（是否出现由容器的 changeset 决定） */
const CHANGESET_TAB_KEY = 'changeset';
/**
 * 文件标签键的前缀：标签键空间里「文件」标签与文件标签必须**不相交**——
 * 直接用路径当键的话，一个「根目录下真有个叫 `files` 的文件」的仓库会与「文件」标签撞键
 * （React 重复 key；且点该文件名会被当成点「文件」标签 → 反而清空 `?file=`，那个文件永远打不开）。
 * 加前缀后两个命名空间天然隔离，同时路径之间本来就唯一。
 */
const FILE_TAB_PREFIX = 'path:';
/** 差异标签键的前缀：同一个路径可能同时开着「该版本的文件内容」与「该文件的变更差异」两个标签，前缀隔离这两个族 */
const DIFF_TAB_PREFIX = 'diff:';
/** 文件路径 → 标签键 */
const fileTabKey = (path: string): string => `${FILE_TAB_PREFIX}${path}`;
/** 标签键 → 文件路径（只会把文件标签的键传进来） */
const pathOfFileTabKey = (key: string): string => key.slice(FILE_TAB_PREFIX.length);
/** 差异文件路径 → 标签键 */
const diffTabKey = (path: string): string => `${DIFF_TAB_PREFIX}${path}`;
/** 标签键 → 差异文件路径（只会把差异标签的键传进来） */
const pathOfDiffTabKey = (key: string): string => key.slice(DIFF_TAB_PREFIX.length);
/** 空数组常量：diffTabs 缺省时的兜底，必须引用稳定（写 `?? []` 会让下面的 useMemo 每帧失效） */
const EMPTY_PATHS: string[] = [];

/** 一个已打开文件的内容副本：只有可显示的值（正文或错误）才记，加载态不记（记了只会让切回来看见空态） */
interface FileSnapshot {
  content?: string;
  binary?: boolean;
  error?: string;
}

/** 一个已打开差异的内容副本（同一套理由：切回已访问的差异标签不再闪加载态） */
interface DiffSnapshot {
  versions?: FileVersions;
  error?: string;
}

/** 变更集标签的受控数据（见文件头「状态归属」） */
export interface SnapshotChangeset {
  /** 该提交的变更集（容器经 useCommitFiles 条件拉取；null/undefined = 未就绪 → 清单显示加载态） */
  entry?: CommittedEntry | null;
  /** 变更集拉取中 */
  loading?: boolean;
  /** 变更集拉取错误信息 */
  error?: string | null;
}

/** 差异标签族（受控：容器持有 open/active，故换提交重挂载后仍存活） */
export interface SnapshotDiffTabs {
  /** 已打开的差异文件路径（顺序 = 打开顺序） */
  open: string[];
  /** 当前激活的差异文件；'' = 不在差异标签上（停在变更集清单或文件标签上） */
  active: string;
}

export interface SnapshotTabsProps {
  /**
   * 「浏览快照」开关（详情面板那个按钮，缺省 true = 开）：为假时整族文件标签不渲染——
   * 没有「文件（N）」文件树、也不会有文件内容标签，标签栏只剩变更集那一族。
   * 缺省 true 是为了纯展示调用方（只给 entries 的老用法）不必额外传参。
   */
  browseTree?: boolean;
  /** 该版本的平铺文件条目（容器经 useBrowseTree 拉取） */
  entries?: BrowseEntry[];
  /** 文件树加载中 */
  loading?: boolean;
  /** 文件树错误信息 */
  error?: string;
  /** 当前激活文件路径（受控，真源在容器 URL）；undefined = 停在「文件」标签 */
  selectedPath?: string;
  /** 当前激活文件的内容（容器只给这一份） */
  content?: BrowseContent;
  /** 当前激活文件内容加载中 */
  contentLoading?: boolean;
  /** 当前激活文件内容错误信息 */
  contentError?: string;
  /** 树里点文件（容器据此写 ?file=，开标签由回传的 selectedPath 完成） */
  onSelectFile?: (path: string) => void;
  /** 切换/关闭标签后要求容器改选中：路径 = 换成该文件；null = 回「文件」标签（清空 ?file=） */
  onActivateTab?: (path: string | null) => void;
  /** 复制当前文件全文（按钮在路径栏，反馈文案由调用方给 copyHint） */
  onCopyAll?: () => void;
  /** 复制反馈文案（由调用方在点「复制全文」后置位、按时清空） */
  copyHint?: string | null;
  /** 变更集（#13）：提供时标签栏多一个「变更集（N）」标签（可关闭） */
  changeset?: SnapshotChangeset | null;
  /** 关闭变更集标签（容器清空 hash 并收起该族差异标签） */
  onCloseChangeset?: () => void;
  /** 变更集清单里点某个文件（容器把它开成差异标签；已开则只切过去） */
  onOpenChangedFile?: (path: string) => void;
  /** 差异标签族（受控，见 SnapshotDiffTabs）；缺省 = 没有差异标签 */
  diffTabs?: SnapshotDiffTabs;
  /** 差异标签族变化（切/关标签）：容器把 open/active 写回自己的状态 */
  onDiffTabsChange?: (next: SnapshotDiffTabs) => void;
  /** 当前激活差异文件的两版全文（容器经 useFileDiff 只给这一份） */
  diffVersions?: FileVersions;
  /** 当前激活差异拉取中 */
  diffLoading?: boolean;
  /** 当前激活差异错误信息 */
  diffError?: string;
  /** Monaco diff 懒加载注入点（测试传 stub 绕过真实 monaco） */
  diffLoader?: MonacoDiffLoader;
}

/** 标签名：取路径最后一段（同名不同目录靠 Tooltip 的全路径区分） */
function basenameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

export function SnapshotTabs({
  browseTree = true,
  entries,
  loading,
  error,
  selectedPath,
  content,
  contentLoading,
  contentError,
  onSelectFile,
  onActivateTab,
  onCopyAll,
  copyHint,
  changeset,
  onCloseChangeset,
  onOpenChangedFile,
  diffTabs,
  onDiffTabsChange,
  diffVersions,
  diffLoading,
  diffError,
  diffLoader,
}: SnapshotTabsProps): ReactNode {
  // 分隔线走主题 token（暗色主题下硬编码浅灰会过亮），与本页其它表头同源
  const { token } = theme.useToken();
  const changesetOpen = changeset !== undefined && changeset !== null;
  const diffOpen = diffTabs?.open ?? EMPTY_PATHS;
  const diffActive = diffTabs?.active ?? '';
  // 已打开的文件标签（顺序 = 打开顺序）；初始值即容器给的选中项（深链直达文件时首帧就开好标签）。
  // 「浏览快照」关着时整族文件标签都不存在——容器此刻若还留着 ?file=，也不该在标签栏里长出一个孤儿标签页
  const [openPaths, setOpenPaths] = useState<string[]>(() => (browseTree && selectedPath !== undefined ? [selectedPath] : []));
  // 激活键：files / changeset / path:<路径> / diff:<路径>
  const [activeKey, setActiveKey] = useState<string>(() => {
    // 挂载优先级见文件头：容器点名的差异标签 > 容器选中的文件 > 变更集 > 文件树
    if (diffActive !== '') return diffTabKey(diffActive);
    if (browseTree && selectedPath !== undefined) return fileTabKey(selectedPath);
    if (changesetOpen) return CHANGESET_TAB_KEY;
    if (browseTree) return SNAPSHOT_TREE_TAB_KEY;
    // 两族全关：没有可落的标签（调用方不会渲染本组件，这里只保证不指向一个不存在的键）
    return '';
  });
  // 每路径的内容副本（见文件头「内容副本」）
  const [snapshots, setSnapshots] = useState<Map<string, FileSnapshot>>(() => new Map());
  // 每路径的差异副本（同上）
  const [diffSnapshots, setDiffSnapshots] = useState<Map<string, DiffSnapshot>>(() => new Map());
  /**
   * 上一次对齐过的 selectedPath。**只在它变化时对齐**，不每帧以容器为准：
   * 用户点「文件」标签时容器那次 URL 回写还没落地（或容器压根不清 ?file=），
   * 每帧对齐会把刚切到树上的用户当场弹回文件标签。
   * 初值就是挂载那一刻的值：首帧的选中已经由上面的初始化（openPaths/activeKey）落到位，
   * 这里再对一次只会把「容器点名的差异标签」抢掉——优先级见文件头。
   */
  const syncedPathRef = useRef<string | undefined>(selectedPath);
  useEffect(() => {
    if (selectedPath === syncedPathRef.current) return;
    syncedPathRef.current = selectedPath;
    // 「浏览快照」关着：文件标签一族不存在，容器给的选中无处安放（开着时再由下面的分支补上）
    if (!browseTree) return;
    // 容器清空选中：回「文件」标签（已打开的标签留着，切回去仍是同一份副本）
    if (selectedPath === undefined) {
      setActiveKey(SNAPSHOT_TREE_TAB_KEY);
      return;
    }
    setOpenPaths((prev) => (prev.includes(selectedPath) ? prev : [...prev, selectedPath]));
    setActiveKey(fileTabKey(selectedPath));
  }, [selectedPath, browseTree]);
  /**
   * 变更集标签从无到有：切过去。用户点「查看变更集」时可能正停在某个差异标签上，
   * 这一跳是那次点击的应有反馈；而重挂载（换提交）时的是否激活由上面的挂载优先级决定，不在这里重复。
   */
  const changesetWasOpenRef = useRef(changesetOpen);
  useEffect(() => {
    if (changesetOpen === changesetWasOpenRef.current) return;
    changesetWasOpenRef.current = changesetOpen;
    if (changesetOpen) setActiveKey(CHANGESET_TAB_KEY);
  }, [changesetOpen]);
  /**
   * 容器改激活的差异标签（用户点了清单里的文件、或剪枝后回落）：只在值变化时跟随。
   * active 变成 '' 时**不在这里处理**——那既可能是剪枝（要让位给变更集清单），
   * 也可能是用户自己切到了别的标签（组件已经切好了，再抢一次会把人弹回清单）。
   * 剪枝那一侧由下面的「键不存在就兜底」覆盖。
   */
  const diffActiveRef = useRef<string | undefined>(diffActive);
  useEffect(() => {
    if (diffActive === diffActiveRef.current) return;
    diffActiveRef.current = diffActive;
    if (diffActive !== '') setActiveKey(diffTabKey(diffActive));
  }, [diffActive]);
  // 内容副本：容器给出可显示的值就按路径记一份（loading 期间不记）
  useEffect(() => {
    if (selectedPath === undefined) return;
    if (content === undefined && contentError === undefined) return;
    setSnapshots((prev) => new Map(prev).set(selectedPath, { content: content?.content, binary: content?.binary, error: contentError }));
  }, [selectedPath, content, contentError]);
  // 差异副本：同上（容器只给「当前激活差异」那一份）
  useEffect(() => {
    if (diffActive === '') return;
    if (diffVersions === undefined && diffError === undefined) return;
    setDiffSnapshots((prev) => new Map(prev).set(diffActive, { versions: diffVersions, error: diffError }));
  }, [diffActive, diffVersions, diffError]);
  /**
   * 切换标签：本地立即生效，再上抛容器改选中（文件标签写 ?file=；差异标签写容器的 open/active）。
   * 切到任何非差异标签都要把容器的 active 清成 ''：否则换提交重挂载时会把用户弹回差异标签，
   * 而用户其实已经自己走开了。
   */
  const activateTab = useCallback(
    (key: string): void => {
      setActiveKey(key);
      if (key === SNAPSHOT_TREE_TAB_KEY) {
        onActivateTab?.(null);
        if (diffActive !== '') onDiffTabsChange?.({ open: diffOpen, active: '' });
        return;
      }
      if (key === CHANGESET_TAB_KEY) {
        if (diffActive !== '') onDiffTabsChange?.({ open: diffOpen, active: '' });
        return;
      }
      if (key.startsWith(DIFF_TAB_PREFIX)) {
        const path = pathOfDiffTabKey(key);
        if (path !== diffActive) {
          onDiffTabsChange?.({ open: diffOpen.includes(path) ? diffOpen : [...diffOpen, path], active: path });
        }
        return;
      }
      onActivateTab?.(pathOfFileTabKey(key));
      if (diffActive !== '') onDiffTabsChange?.({ open: diffOpen, active: '' });
    },
    [onActivateTab, onDiffTabsChange, diffActive, diffOpen],
  );
  /**
   * 关闭标签：先从标签栏移除；关掉的若是**当前激活**或**容器选中/激活**的那一个，按「右邻 → 左邻 → 兜底」
   * 顺位接管，让容器把选中（?file= 或 diff active）一起挪过去（否则会出现「标签没了、URL 还指着一个看不见的文件」）。
   * 为什么两个判据都要看：用户点「文件」标签后容器那次 URL 回写可能还没落地（或容器不清 ?file=），
   * 此时 activeKey=树 而 selectedPath 仍是那个文件——只看 activeKey 会把这种偏差态漏成死状态
   * （标签关掉了、树里仍高亮、URL 仍指着它）。差异标签同理由（容器 active 与本地激活键可能差一拍）。
   */
  const onEdit: NonNullable<TabsProps['onEdit']> = (targetKey, action) => {
    if (action !== 'remove') return;
    const key = String(targetKey);
    // 关掉变更集标签 = 整个变更集标签族收摊：容器清空 hash（并连带收起已开差异标签），
    // 本地激活键落到文件树（若容器的差异标签还在，下面的「键不存在就兜底」会把它接上）
    if (key === CHANGESET_TAB_KEY) {
      setActiveKey(SNAPSHOT_TREE_TAB_KEY);
      onCloseChangeset?.();
      return;
    }
    if (key.startsWith(DIFF_TAB_PREFIX)) {
      const path = pathOfDiffTabKey(key);
      const rest = diffOpen.filter((p) => p !== path);
      // 副本随标签一起丢：否则关掉的大文件全文会一直挂在内存里（直到换版本重挂载）
      setDiffSnapshots((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      if (path !== diffActive && key !== activeKey) {
        onDiffTabsChange?.({ open: rest, active: diffActive });
        return;
      }
      const index = diffOpen.indexOf(path);
      const successor = diffOpen[index + 1] ?? diffOpen[index - 1];
      setActiveKey(
        successor === undefined ? (changesetOpen ? CHANGESET_TAB_KEY : SNAPSHOT_TREE_TAB_KEY) : diffTabKey(successor),
      );
      onDiffTabsChange?.({ open: rest, active: successor ?? '' });
      return;
    }
    setOpenPaths((prev) => prev.filter((p) => fileTabKey(p) !== key));
    // 副本随标签一起丢：否则关掉的大文件全文会一直挂在内存里（直到换版本重挂载）
    setSnapshots((prev) => {
      const next = new Map(prev);
      next.delete(pathOfFileTabKey(key));
      return next;
    });
    if (key !== activeKey && pathOfFileTabKey(key) !== selectedPath) return;
    const index = openPaths.findIndex((p) => fileTabKey(p) === key);
    const next = openPaths[index + 1] ?? openPaths[index - 1];
    if (next === undefined) {
      // 关掉最后一个文件标签：回文件树，并要求容器清空 ?file=
      setActiveKey(SNAPSHOT_TREE_TAB_KEY);
      onActivateTab?.(null);
      return;
    }
    activateTab(fileTabKey(next));
  };
  /** 单个文件标签的正文区：路径栏（路径 + 复制/新标签页动作）+ 只读代码视图 */
  const renderFilePane = useCallback((path: string): ReactNode => {
    const snapshot = snapshots.get(path);
    const isActive = path === selectedPath;
    /* 激活标签用容器给的那一份（只有它带 loading/error 时序）；容器正在重新拉取而已有副本时，
       先用副本显示——切回来不再闪一次加载态。非激活标签一律用副本（容器的数据不属于它）。 */
    const useLive = isActive && !(contentLoading === true && snapshot !== undefined);
    const view = useLive ? { content: content?.content, binary: content?.binary, error: contentError } : snapshot;
    const viewLoading = useLive && contentLoading === true;
    return (
      /* 高度用 height:100% 而不是 flex:1：标签页本体（.ant-tabs-content）是块盒，
         非激活页靠 antd 的 `.ant-tabs-content-hidden{display:none}` 隐藏——
         这一层**绝不能再写行内 display**（行内 display 会盖掉那条隐藏规则，所有标签页会一起摊开，
         实测过一次：三个文件的内容在栏里上下叠成一列）。 */
      <Flex vertical style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
        {/* 路径栏：左边是这一版／这个文件的定位信息，右边是复制全文（内边距与正文一致，靠 antd 默认行高） */}
        <Flex
          align="center"
          gap={8}
          style={{ padding: '4px 8px', borderBottom: `1px solid ${token.colorSplit}`, minWidth: 0 }}
        >
          <Typography.Text
            code
            data-testid="browse-content-path"
            ellipsis={{ tooltip: path }}
            style={{ minWidth: 0, flex: 1 }}
          >
            {path}
          </Typography.Text>
          <ReadonlyTextActions
            content={view?.content}
            binary={view?.binary}
            onCopyAll={onCopyAll}
          />
        </Flex>
        {view === undefined && !viewLoading ? (
          /* 没有副本、也不在加载：开了标签就立刻切走时（容器把内容通道切给了别人）会落到这里。
             文案不能写「切回该标签页」——它也可能出现在**当前激活**的标签上（组件不保证容器一定在拉它）。 */
          <Flex vertical data-testid={`snapshot-file-pending-${path}`} style={{ flex: 1, minHeight: 0 }}>
            <EmptyState title="内容尚未加载" description="再点一次树里的这个文件名即可重新获取" />
          </Flex>
        ) : (
          <ReadonlyTextView
            path={path}
            content={view?.content}
            binary={view?.binary}
            error={view?.error}
            loading={viewLoading}
            // 复制反馈只在激活标签上显示（切走后按钮不在视野里，留着会让人以为刚复制的是这一份）
            copyHint={isActive ? copyHint : null}
          />
        )}
      </Flex>
    );
  }, [snapshots, selectedPath, content, contentError, contentLoading, copyHint, onCopyAll, token.colorSplit]);
  /** 单个差异标签的正文区：路径栏 + 差异视图（降级提示行由 ChangesetDiffPane 按条目属性决定） */
  const renderDiffPane = useCallback((path: string): ReactNode => {
    const snapshot = diffSnapshots.get(path);
    const isActive = path === diffActive;
    /* 与文件标签同一套「先副本、后 live」口径：容器正在重取而已有副本时先用副本（不闪加载态），
       非激活标签一律用副本（容器的数据只属于当前激活的那一个）。 */
    const useLive = isActive && !(diffLoading === true && snapshot !== undefined);
    const view = useLive ? { versions: diffVersions, error: diffError } : snapshot;
    const entry = changeset?.entry ?? null;
    const file = entry?.files.find((f) => f.path === path);
    return (
      <ChangesetDiffPane
        path={path}
        // 同组文件 = 该提交的变更集：路径栏右端的「上一个 / 下一个」按这个顺序前后翻（切文件 = 在同一栏开/切标签）
        files={entry === null ? EMPTY_PATHS : entry.files.map((f) => f.path)}
        onNavigateFile={(next) => activateTab(diffTabKey(next))}
        {...(file?.renameFrom === undefined ? {} : { renameFrom: file.renameFrom })}
        // 根提交整份变更集都没有父版本（按提交判定，而不是按文件）：与差异页同口径只给提示行
        rootCommit={entry !== null && entry.parents.length === 0}
        {...(view?.versions === undefined ? {} : { versions: view.versions })}
        // 未就绪与加载中同屏：容器在「变更集还没拉到」这段窗口里也没有 versions 可给
        loading={view === undefined || (useLive && diffLoading === true)}
        {...(view?.error === undefined ? {} : { error: view.error })}
        {...(diffLoader === undefined ? {} : { loader: diffLoader })}
      />
    );
  }, [diffSnapshots, diffActive, diffVersions, diffError, diffLoading, changeset, diffLoader, activateTab]);
  const items: NonNullable<TabsProps['items']> = useMemo(
    () => [
      // 「文件（N）」只在「浏览快照」开着时出现（见文件头两族标签的显隐）
      ...(browseTree
        ? [
          {
            key: SNAPSHOT_TREE_TAB_KEY,
            // 文件夹图标 + 不可关闭：这是挑文件的入口，关掉它就没有别的入口了（用户口径：树自成标签）
            icon: <FolderOutlined />,
            closable: false,
            label: (
              <Tooltip title="文件树：以该版本的文件列表挑文件，点文件名把它开成一个标签页">
                <span data-testid="snapshot-tree-title">文件（{entries?.length ?? 0}）</span>
              </Tooltip>
            ),
            children: (
              <Flex
                vertical
                data-testid="snapshot-tree-pane"
                style={{ height: '100%', minHeight: 0, minWidth: 0, overflow: 'auto', padding: 8 }}
              >
                <SnapshotTreeColumn
                  entries={entries}
                  loading={loading}
                  error={error}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                />
              </Flex>
            ),
          },
        ]
        : []),
      ...(changesetOpen
        ? [
          {
            key: CHANGESET_TAB_KEY,
            label: (
              <Tooltip
                title={
                  changeset.entry === undefined || changeset.entry === null
                    ? '本次提交的变更集：加载中'
                    : `本次提交（${changeset.entry.shortHash}）涉及的全部文件；点文件名在同一标签栏打开它的差异`
                }
              >
                <span data-testid="snapshot-changeset-title">
                  变更集（{changeset.entry?.files.length ?? 0}）
                </span>
              </Tooltip>
            ),
            children: (
              <Flex
                vertical
                data-testid="snapshot-changeset-pane"
                style={{ height: '100%', minHeight: 0, minWidth: 0, overflow: 'auto', padding: 8 }}
              >
                <ChangesetList
                  entry={changeset.entry}
                  loading={changeset.loading}
                  error={changeset.error}
                  onOpenFile={onOpenChangedFile}
                />
              </Flex>
            ),
          },
        ]
        : []),
      ...openPaths.map((path) => ({
        key: fileTabKey(path),
        label: (
          <Tooltip title={path}>
            <span data-testid={`snapshot-file-tab-${path}`}>{basenameOf(path)}</span>
          </Tooltip>
        ),
        children: renderFilePane(path),
      })),
      ...diffOpen.map((path) => ({
        key: diffTabKey(path),
        label: (
          <Tooltip title={`与父提交对比：${path}`}>
            <span data-testid={`changes-diff-tab-${path}`}>{basenameOf(path)}</span>
          </Tooltip>
        ),
        children: renderDiffPane(path),
      })),
    ],
    [
      browseTree,
      entries,
      loading,
      error,
      selectedPath,
      onSelectFile,
      openPaths,
      renderFilePane,
      changesetOpen,
      changeset,
      onOpenChangedFile,
      diffOpen,
      renderDiffPane,
    ],
  );
  /**
   * 兜底激活键：本地激活键指向的标签**已经不存在**时（关掉变更集族、容器剪掉差异标签）落到
   * 「容器点名的差异标签 → 容器选中的文件 → 变更集 → 文件树」，与挂载优先级同序；
   * 某族被开关关掉时不参与兜底（关着就没有那个标签可落）。
   * 只做「键不存在」的兜底，不参与用户点击——用户刚点的标签一定存在，故不会被这里抢走。
   */
  const activeKeyExists =
    (activeKey === SNAPSHOT_TREE_TAB_KEY && browseTree) ||
    (activeKey === CHANGESET_TAB_KEY && changesetOpen) ||
    (activeKey.startsWith(FILE_TAB_PREFIX) && browseTree && openPaths.includes(pathOfFileTabKey(activeKey))) ||
    (activeKey.startsWith(DIFF_TAB_PREFIX) && diffOpen.includes(pathOfDiffTabKey(activeKey)));
  const fallbackKey =
    diffActive !== '' && diffOpen.includes(diffActive)
      ? diffTabKey(diffActive)
      : browseTree && selectedPath !== undefined
        ? fileTabKey(selectedPath)
        : changesetOpen
          ? CHANGESET_TAB_KEY
          : browseTree
            ? SNAPSHOT_TREE_TAB_KEY
            : '';
  return (
    <Tabs
      data-testid="snapshot-tabs"
      /* 卡片式标签：与参考图一致（标签自带边框、激活项与内容区相连），且只有它支持关闭按钮 */
      type="editable-card"
      // 没有「新建标签页」这种动作（文件只能从树里开），故不渲染 + 按钮
      hideAdd
      activeKey={activeKeyExists ? activeKey : fallbackKey}
      onChange={activateTab}
      onEdit={onEdit}
      items={items}
      /* 高度契约（两层，缺一层就会退化成「内容多高就多高」）：
         ① `.ant-tabs-body-holder` 被 antd 的 `flex: auto` 撑到剩余高度，但**它是普通块盒**，
            故 `.ant-tabs-body` 上的 `flex: 1` 是惰性的——必须用 `height: 100%` 去解析 holder 的高度；
         ② `.ant-tabs-body` 是纵向 flex，标签页本体给 `flex: 1` 吃满。
         注意 `styles.content` 是**逐标签页**生效的（每个 `.ant-tabs-content` 一份），
         且只能给尺寸、**不能给 display**：非激活标签页靠 antd 的 `.ant-tabs-content-hidden{display:none}`
         隐藏，行内 display 会盖掉那条规则（实测会把所有标签页摊成一列）。
         `root` 的 flexDirection 与 `.ant-tabs-top` 自带的重复，写明是为了让这套契约自解释（改 placement 时能一眼看到）。 */
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
      styles={{
        root: { display: 'flex', flexDirection: 'column', minHeight: 0 },
        body: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
        content: { flex: 1, minHeight: 0 },
      }}
    />
  );
}
