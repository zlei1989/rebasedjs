/**
 * 右栏「变更内容」：四个视图标签（原顶部操作条按用户口径**整行删除**——文件名与
 * 日志定位/差异页/受影响/文件历史 四个出口一并下线；受影响的那份清单由「提交详情」标签就地承担）。
 *   · 标签1「本文件改动」= 该提交对当前文件的 diff（from=父提交、to=该提交）；
 *   · 标签2「与最新版本差异」= 该提交的该文件版本 vs **当前工作区版本**（from-only 语义）；
 *   · 标签3「逐行注解」= 该提交版本的逐行归属（BlameAnnotateTable）；
 *   · 标签4「提交详情」= 选中提交的详情卡 + 变更集清单。两处都**复用既有组件**而不是另写一套：
 *     domain/commit-details-panel（与日志页详情面板同一个）与 composite/changeset-pane 的 ChangesetList
 *     （与日志页「变更集（N）」标签同一份清单 → 状态徽标、重命名「旧 → 新」、两种空态天然一致）；
 *     清单点文件名 → 容器在新标签页打开该文件的差异页（from=父、to=该提交）。
 * 三种降级（根提交 / 重命名 / 该提交的版本里没有这个路径）**不做伪 diff**——与差异页、日志页变更集标签
 * 同一口径（判据见 composite/history-state 的 changesHints）。其中**根提交另有内容可看**：没有父版本可比，
 * 但这一版的文件全文就是这次提交新添加的全部内容，故标签1 在 Alert 提示下用只读代码视图（语法高亮）
 * 把它就地读出来（数据由容器经 rootContent 通道给，走既有 browse/content 端点，**不发差异请求**）；
 * 重命名与「这一版没有这个路径」两种降级连内容也取不到，仍是纯提示行。
 * 纯受控：不调接口、不碰 URL，数据与动作全部由容器给。
 */
import { Alert, Flex, Spin, Tabs, Typography } from 'antd';
import type { TabsProps } from 'antd';
import type { BlameLine, CommittedEntry, FileVersions } from '@rebased/contracts';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';
import type { LineHighlighterLoader } from '../base/line-highlighter';
import type { MonacoLazyLoader } from '../base/monaco-lazy';
import { EmptyState } from '../base/empty-state';
import { ReadonlyTextView } from '../base/readonly-text-view';
import { CommitDetailsPanel } from '../domain/commit-details-panel';
import { DiffViewer } from '../domain/diff-viewer';
import { languageForPath } from '../domain/language';
import { BlameAnnotateTable, type BlameDetailState } from './blame-annotate-table';
import { changesHints, type HistoryViewKey } from './history-state';
import { ChangesetList } from './changeset-pane';
import { toCommitInfo } from './commit-detail-card';

/** 一个差异标签的数据通道（全文 + 三态） */
export interface HistoryDiffChannel {
  versions?: FileVersions;
  loading?: boolean;
  error?: string;
}

/** 根提交标签1 的文件内容通道（该提交里的文件全文 + 三态；形状对齐 BrowseContent） */
export interface HistoryContentChannel {
  content?: string;
  /** 二进制文件：只提示不渲染（容器取自 browse/content 的同名字段） */
  binary?: boolean;
  loading?: boolean;
  error?: string;
}

export interface HistoryChangePaneProps {
  /** 当前归属的文件路径（差异两侧、注解与语言推断都用它） */
  file: string;
  /** 选中的提交哈希（'' = 没有可看的提交，整块走空态） */
  hash: string;
  view: HistoryViewKey;
  onViewChange?: (view: HistoryViewKey) => void;
  /** 选中提交的变更集（容器经 useCommitFiles 拉取）：父提交与三种降级判据的唯一来源 */
  entry?: CommittedEntry | null;
  /** 标签1：本文件改动 */
  changes: HistoryDiffChannel;
  /** 标签1 的根提交分支：该提交里的文件全文（容器经 useBrowseContent 条件拉取；非根提交时容器不给） */
  rootContent?: HistoryContentChannel;
  /** 标签2：与最新版本差异 */
  latest: HistoryDiffChannel;
  /** 标签3：逐行注解 */
  annotate: { lines?: BlameLine[]; loading?: boolean; error?: string };
  /** 注解行的哈希详情浮层（受控）：由容器持有「展开了哪个哈希」与它的取数三态 */
  detail?: BlameDetailState | null;
  /** 注解行点哈希 → 切换浮层（传 null 关闭） */
  onToggleDetail?: (hash: string | null) => void;
  /** 测试注入点：替换注解行的高亮加载器（默认懒加载真实 Shiki） */
  annotateLoader?: LineHighlighterLoader;
  /** 测试注入点：替换根提交内容视图的加载器（默认懒加载真实 Monaco） */
  contentLoader?: MonacoLazyLoader;
  /** 主区域（注解行）当前选中的提交：归属它的行加底色 */
  selectedHash?: string | null;
  /** 注解行点击 → 选中该行归属的提交 */
  onSelectCommit?: (hash: string) => void;
  /**
   * 「提交详情」标签的取数三态（与 `entry` 同源，只是换了表达）：变更集还没到 → 加载态，
   * 拉取失败（如陈旧 `?select=` 指向不存在的提交）→ 中文错误原样透出。
   * 为什么不让 ChangesetList 自己接 loading/error：那个组件在这条路上收到的恒是**已就绪**的 entry，
   * 三态由本组件与其它标签统一分派，免得同一件事两处各判一遍。
   */
  entryState?: { loading?: boolean; error?: string };
  /** 「提交详情」标签：点变更集里的文件名 → 容器在新标签页打开该文件的差异页（from=父、to=该提交） */
  onOpenChangedFile?: (path: string) => void;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
}

export function HistoryChangePane({
  file,
  hash,
  view,
  onViewChange,
  entry,
  changes,
  rootContent,
  latest,
  annotate,
  selectedHash,
  onSelectCommit,
  entryState,
  onOpenChangedFile,
  detail,
  onToggleDetail,
  annotateLoader,
  contentLoader,
  loader,
}: HistoryChangePaneProps): React.ReactNode {
  // 没有可看的提交：整块空态（中栏空清单、或深链里 ?select= 为空时都走这里）
  if (hash === '') {
    return <EmptyState title="暂无提交可查看" description="该文件在当前分支还没有提交记录" />;
  }
  const hints = changesHints(entry, hash, file);
  const items: NonNullable<TabsProps['items']> = [
    {
      key: 'changes',
      label: '本文件改动',
      children: (
        <div data-testid="history-view-changes" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
          {/* 根提交单独一路：没有父版本可比，但该版本的文件全文就是这次提交新增的全部内容，照样有得看 */}
          {hints.rootCommit ? rootCommitBody() : diffBody(changes, 'changes', changesHint(hints))}
        </div>
      ),
    },
    {
      key: 'latest',
      label: '与最新版本差异',
      children: (
        <div data-testid="history-view-latest" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
          {diffBody(latest, 'latest', latestHint(hints))}
        </div>
      ),
    },
    {
      key: 'annotate',
      label: '逐行注解',
      children: (
        <div data-testid="history-view-annotate" style={{ height: '100%', minHeight: 0, minWidth: 0, overflow: 'auto' }}>
          <BlameAnnotateTable
            lines={annotate.lines}
            loading={annotate.loading}
            error={annotate.error}
            selectedHash={selectedHash}
            // 语言按当前文件路径推断（与两个差异标签同一口径）；推不出即纯文本
            language={languageForPath(file)}
            {...(onSelectCommit === undefined ? {} : { onSelectCommit })}
            {...(detail === undefined ? {} : { detail })}
            {...(onToggleDetail === undefined ? {} : { onToggleDetail })}
            {...(annotateLoader === undefined ? {} : { highlightLoader: annotateLoader })}
          />
        </div>
      ),
    },
    {
      key: 'detail',
      label: '提交详情',
      children: (
        <div
          data-testid="history-view-detail"
          style={{ height: '100%', minHeight: 0, minWidth: 0, overflow: 'auto', padding: 8 }}
        >
          {detailBody()}
        </div>
      ),
    },
  ];
  return (
    <Flex vertical data-testid="history-pane" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
      {/* 高度契约（两层，缺一层就退化成「内容多高就多高」；与 composite/snapshot-tabs 同一份，那边为这个坑付过代价）：
          ① `.ant-tabs-body-holder` 被 antd 的 `flex: auto` 撑到剩余高度，但**它是普通块盒**——
             故 `.ant-tabs-body` 上的 `flex: 1` 是惰性的，必须用 `height: 100%` 去解析 holder 的高度；
          ② `.ant-tabs-body` 是纵向 flex，标签页本体给 `flex: 1` 吃满。
          少了这层，各标签包裹层与 DiffViewer 的 `height: 100%`、monaco 容器的 `height: 100%` 全部落到
          auto 高度祖先上（monaco 子元素是绝对定位）→ 编辑器拿到零高盒子，注解区的 `overflow: auto` 也永不滚动。
          注意 `styles.content` **逐标签页**生效且只能给尺寸、不能给 display（非激活标签页靠 antd 的
          `.ant-tabs-content-hidden{display:none}` 隐藏，行内 display 会把它盖掉、把所有标签页摊成一列）。
          外层与 Tabs 都只给 flex、不给固定 px 高度：右栏高度由宿主（Task 7 的弹性栏）决定。 */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Tabs
          size="small"
          activeKey={view}
          onChange={(key) => onViewChange?.(key as HistoryViewKey)}
          items={items}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          styles={{
            root: { display: 'flex', flexDirection: 'column', minHeight: 0 },
            body: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
            content: { flex: 1, minHeight: 0 },
          }}
        />
      </div>
    </Flex>
  );

  /**
   * 标签4「提交详情」正文：该提交的详情卡 + 变更集清单。
   * 为什么两处都复用别处已有的组件：
   *   · 详情卡用 domain/commit-details-panel（日志页详情面板与注解行浮层用的同一个）——主题加粗、
   *     正文块、短哈希点击复制完整哈希、作者 + 时间、父提交；映射用 commit-detail-card 的 toCommitInfo。
   *   · 清单用 composite/changeset-pane 的 ChangesetList（日志页「变更集（N）」标签用的同一个）——
   *     状态徽标、重命名「旧 → 新」、合并提交/无变更两种空态因此与日志页逐字一致，不另写一套样式。
   * 三态判据取 changesHints 的 ready 而不是「entry 非空」：SWR 换键那一拍 data 可能还挂着上一个提交的变更集，
   * 拿它当就绪会渲染出「张冠李戴」的清单与详情（与两个差异标签同一口径）。
   * 父提交链接不接 onSelectCommit：父提交通常没动过当前文件，接上会把三个标签一起带进降级态
   * （详情面板对未注入的情形有 `#hash` 锚点兜底，不承诺跳转）。
   */
  function detailBody(): React.ReactNode {
    if (entryState?.error !== undefined) {
      return (
        <Typography.Text type="danger" data-testid="history-view-detail-error">
          {entryState.error}
        </Typography.Text>
      );
    }
    if (!hints.ready) return <Spin data-testid="history-view-detail-loading" />;
    const ready = entry as CommittedEntry;
    return (
      <Flex vertical gap={8} data-testid="history-detail-body">
        <CommitDetailsPanel commit={toCommitInfo(ready)} data-testid="history-commit-detail" />
        <ChangesetList entry={ready} {...(onOpenChangedFile === undefined ? {} : { onOpenFile: onOpenChangedFile })} />
      </Flex>
    );
  }

  /**
   * 根提交的标签1：Alert 提示（没有父版本可比）+ **该提交里的文件全文**（只读代码视图，按扩展名语法高亮）。
   * 为什么不止一行提示：差异确实无从谈起，但「这一版的文件内容」是有的，而它正是这次提交新添加的全部内容——
   * 就地读出来看，比让用户切别的标签再找一遍有用。数据由容器经 `rootContent` 通道给（走既有 browse/content
   * 端点读该版本全文，**不发差异请求**：没有可比的两端，发出去只会拿回两个空文档）。
   * 高度契约：Alert 只占自身高度，下面的代码视图吃满剩余高度——少了 flex:1 + minHeight:0 这层，
   * ReadonlyTextView 的 height:100% 会落到 auto 高度祖先上，Monaco 子元素（绝对定位）就拿到零高盒子。
   */
  function rootCommitBody(): React.ReactNode {
    return (
      <Flex vertical gap={8} style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
        <Alert
          type="info"
          showIcon
          data-testid="history-changes-root-hint"
          title="该提交为根提交（无父版本），无法按父级对比变更；该文件的初始内容可在「逐行注解」标签查看"
        />
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <ReadonlyTextView
            path={file}
            content={rootContent?.content}
            binary={rootContent?.binary}
            loading={rootContent?.loading}
            error={rootContent?.error}
            {...(contentLoader === undefined ? {} : { loader: contentLoader })}
          />
        </div>
      </Flex>
    );
  }

  /**
   * 标签1 的降级提示行（根提交不走这里，它有 rootCommitBody 那一路）：重命名 → 两侧文件名不同，
   * 单文件对比会误读成「全新增」；该提交里没有这个路径 → 这一版里它还不存在（改名之前 / 尚未创建）。
   * 都没有则 null（正常渲染差异）。
   */
  function changesHint(h: ReturnType<typeof changesHints>): React.ReactNode {
    // renameFrom 为空串不是合法原名：只判 undefined 会渲染出「该变更涉及重命名： → src/app.ts」
    // 这种空名字的提示行（判据一律取自 changesHints，此处不做二次推导）
    if (h.renameFrom !== undefined && h.renameFrom !== '') {
      return (
        <Typography.Text type="secondary" data-testid="history-changes-rename-hint">
          {/* 改名之前的提交就在本页中栏（--follow 清单），不再指向已删除的历史页 */}
          该变更涉及重命名：{h.renameFrom} → {file}（本页中栏的提交记录已含改名之前的提交）
        </Typography.Text>
      );
    }
    if (h.missingPath) {
      return (
        <Typography.Text type="secondary" data-testid="history-changes-missing-hint">
          该提交的版本里没有这个路径（可能当时它叫别的名字，或还没有这个文件）
        </Typography.Text>
      );
    }
    return null;
  }

  /** 标签2 的降级提示行：该提交版本里没有这个路径时，与工作区对比只会显示「全新增」，同样不做伪对比 */
  function latestHint(h: ReturnType<typeof changesHints>): React.ReactNode {
    if (h.missingPath) {
      return (
        <Typography.Text type="secondary" data-testid="history-latest-missing-hint">
          该提交的版本里没有这个路径（可能当时它叫别的名字，或还没有这个文件），无法与当前版本对比
        </Typography.Text>
      );
    }
    return null;
  }

  /** 差异正文：提示行优先于数据状态（它不依赖取数）；随后错误 → 加载 → 差异视图 */
  function diffBody(channel: HistoryDiffChannel, key: 'changes' | 'latest', hint: React.ReactNode): React.ReactNode {
    if (hint !== null) return hint;
    if (channel.error !== undefined) {
      return (
        <Typography.Text type="danger" data-testid={`history-${key}-error`}>
          {channel.error}
        </Typography.Text>
      );
    }
    if (channel.versions === undefined || channel.loading === true) {
      return <Spin data-testid={`history-${key}-loading`} />;
    }
    return (
      <div style={{ height: '100%', minHeight: 0 }}>
        <DiffViewer
          versions={channel.versions}
          // 定提交对比模式：与 staged/工作区切换互斥（服务端 XOR 校验会给 400），故不传 onToggleStaged；
          // 宿主是右栏（可能是窄栏），以「行内」开场——仅作没存过偏好时的初值
          staged={false}
          language={languageForPath(file)}
          fromTo
          initialSideBySide={false}
          {...(loader === undefined ? {} : { loader })}
        />
      </div>
    );
  }
}
