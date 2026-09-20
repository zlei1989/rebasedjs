/**
 * 右栏「变更内容」：操作条（选中提交级） + 三个视图标签。
 *   · 操作条：在提交日志中定位 / 新标签页打开差异 / 受影响文件 / 文件历史页——
 *     原溯源行内的四个出口（F-102/F-103）升格成「选中提交级」：中栏选中已是本页一等动作，
 *     每行再挤四个按钮既放不下也重复（用户口径，见 design §1.4 / D4）；
 *   · 标签1「本文件改动」= 该提交对当前文件的 diff（from=父提交、to=该提交）；
 *   · 标签2「与最新版本差异」= 该提交的该文件版本 vs **当前工作区版本**（from-only 语义）；
 *   · 标签3「逐行注解」= 该提交版本的逐行归属（BlameAnnotateTable）。
 * 三种降级（根提交 / 重命名 / 该提交的版本里没有这个路径）只给提示行、**不做伪 diff**——
 * 与差异页、日志页变更集标签同一口径（判据见 composite/blame-state 的 changesHints）。
 * 纯受控：不调接口、不碰 URL，数据与动作全部由容器给。
 */
import { Button, Flex, Spin, Tabs, Tooltip, Typography, theme } from 'antd';
import type { TabsProps } from 'antd';
import type { BlameLine, CommittedEntry, FileVersions } from '@rebased/contracts';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';
import { EmptyState } from '../base/empty-state';
import { DiffViewer } from '../domain/diff-viewer';
import { languageForPath } from '../domain/language';
import { AffectedFilesModal } from './affected-files-modal';
import { BlameAnnotateTable } from './blame-annotate-table';
import { changesHints, type BlameViewKey } from './blame-state';

/** 一个差异标签的数据通道（全文 + 三态） */
export interface BlameDiffChannel {
  versions?: FileVersions;
  loading?: boolean;
  error?: string;
}

export interface BlameChangePaneProps {
  /** 当前溯源的文件路径（差异两侧、注解与语言推断都用它） */
  file: string;
  /** 选中的提交哈希（'' = 没有可看的提交，整块走空态） */
  hash: string;
  view: BlameViewKey;
  onViewChange?: (view: BlameViewKey) => void;
  /** 选中提交的变更集（容器经 useCommitFiles 拉取）：父提交与三种降级判据的唯一来源 */
  entry?: CommittedEntry | null;
  /** 标签1：本文件改动 */
  changes: BlameDiffChannel;
  /** 标签2：与最新版本差异 */
  latest: BlameDiffChannel;
  /** 标签3：逐行注解 */
  annotate: { lines?: BlameLine[]; loading?: boolean; error?: string };
  /** 主区域（注解行）当前选中的提交：归属它的行加底色 */
  selectedHash?: string | null;
  /** 注解行点击 → 选中该行归属的提交 */
  onSelectCommit?: (hash: string) => void;
  /** 操作条：在提交日志中定位该提交（只导航，不改工作区） */
  onOpenCommit?: (hash: string) => void;
  /** 操作条：新标签页打开该提交对本文件的差异页 */
  onOpenDiff?: (hash: string) => void;
  /** 操作条：打开受影响文件弹窗 */
  onShowAffected?: (hash: string) => void;
  /** 操作条：打开本文件的文件历史页 */
  onOpenInHistory?: (hash: string) => void;
  /** 受影响弹窗（受控：hash 为空串 = 关闭） */
  affected: { hash: string; entry?: CommittedEntry | null; loading?: boolean; error?: string | null };
  onCloseAffected?: () => void;
  onOpenAffectedFile?: (path: string) => void;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
}

export function BlameChangePane({
  file,
  hash,
  view,
  onViewChange,
  entry,
  changes,
  latest,
  annotate,
  selectedHash,
  onSelectCommit,
  onOpenCommit,
  onOpenDiff,
  onShowAffected,
  onOpenInHistory,
  affected,
  onCloseAffected,
  onOpenAffectedFile,
  loader,
}: BlameChangePaneProps): React.ReactNode {
  // 操作条下边线与选中底色走主题 token（暗色主题下硬编码浅灰会过亮）
  const { token } = theme.useToken();
  // 没有可看的提交：整块空态（中栏空清单、或深链里 ?select= 为空时都走这里）
  if (hash === '') {
    return <EmptyState title="暂无提交可查看" description="该文件在当前分支还没有提交记录" />;
  }
  const hints = changesHints(entry, hash, file);
  /** 操作条四个出口：只在容器注入回调时渲染（无死控件） */
  const actions = [
    ...(onOpenCommit === undefined
      ? []
      : [{ key: 'log', testid: 'blame-action-log', label: '日志定位', tip: '在提交日志中定位该提交并选中它（只做导航，不改动工作区）', run: onOpenCommit }]),
    ...(onOpenDiff === undefined
      ? []
      : [{ key: 'diff', testid: 'blame-action-diff', label: '差异页', tip: '在新标签页打开差异页：该提交与其父提交对比（本页留在原处）；根提交只显示提示行', run: onOpenDiff }]),
    ...(onShowAffected === undefined
      ? []
      : [{ key: 'affected', testid: 'blame-action-affected', label: '受影响', tip: '打开该提交改动的全部文件清单；合并提交默认不列出文件变更', run: onShowAffected }]),
    ...(onOpenInHistory === undefined
      ? []
      : [{ key: 'history', testid: 'blame-action-history', label: '文件历史', tip: '打开本文件的提交历史页（含改名之前的历史）', run: onOpenInHistory }]),
  ];
  const items: NonNullable<TabsProps['items']> = [
    {
      key: 'changes',
      label: '本文件改动',
      children: (
        <div data-testid="blame-view-changes" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
          {diffBody(changes, 'changes', changesHint(hints))}
        </div>
      ),
    },
    {
      key: 'latest',
      label: '与最新版本差异',
      children: (
        <div data-testid="blame-view-latest" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
          {diffBody(latest, 'latest', latestHint(hints))}
        </div>
      ),
    },
    {
      key: 'annotate',
      label: '逐行注解',
      children: (
        <div data-testid="blame-view-annotate" style={{ height: '100%', minHeight: 0, minWidth: 0, overflow: 'auto' }}>
          <BlameAnnotateTable
            lines={annotate.lines}
            loading={annotate.loading}
            error={annotate.error}
            selectedHash={selectedHash}
            {...(onSelectCommit === undefined ? {} : { onSelectCommit })}
          />
        </div>
      ),
    },
  ];
  return (
    <Flex vertical data-testid="blame-pane" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
      <Flex
        align="center"
        gap={8}
        wrap
        data-testid="blame-pane-actions"
        style={{ padding: '4px 8px', borderBottom: `1px solid ${token.colorSplit}`, minWidth: 0 }}
      >
        <Typography.Text code ellipsis={{ tooltip: file }} style={{ flex: 1, minWidth: 120 }}>
          {file}
        </Typography.Text>
        {actions.map((action) => (
          <Tooltip key={action.key} title={action.tip}>
            <Button size="small" type="text" data-testid={action.testid} onClick={() => action.run(hash)}>
              {action.label}
            </Button>
          </Tooltip>
        ))}
      </Flex>
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
          onChange={(key) => onViewChange?.(key as BlameViewKey)}
          items={items}
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          styles={{
            root: { display: 'flex', flexDirection: 'column', minHeight: 0 },
            body: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
            content: { flex: 1, minHeight: 0 },
          }}
        />
      </div>
      {onShowAffected === undefined ? null : (
        <AffectedFilesModal
          hash={affected.hash}
          entry={affected.entry}
          loading={affected.loading}
          error={affected.error}
          onClose={onCloseAffected}
          onOpenFile={onOpenAffectedFile}
        />
      )}
    </Flex>
  );

  /**
   * 标签1 的降级提示行：根提交 → 无父版本；重命名 → 两侧文件名不同，单文件对比会误读成「全新增」；
   * 该提交里没有这个路径 → 这一版里它还不存在（改名之前 / 尚未创建）。都没有则 null（正常渲染差异）。
   */
  function changesHint(h: ReturnType<typeof changesHints>): React.ReactNode {
    if (h.rootCommit) {
      return (
        <Typography.Text type="secondary" data-testid="blame-changes-root-hint">
          该提交为根提交（无父版本），无法按父级对比变更；该文件的初始内容可在「逐行注解」标签查看
        </Typography.Text>
      );
    }
    // renameFrom 为空串不是合法原名：只判 undefined 会渲染出「该变更涉及重命名： → src/app.ts」
    // 这种空名字的提示行（判据一律取自 changesHints，此处不做二次推导）
    if (h.renameFrom !== undefined && h.renameFrom !== '') {
      return (
        <Typography.Text type="secondary" data-testid="blame-changes-rename-hint">
          该变更涉及重命名：{h.renameFrom} → {file}（改名前的历史请到「文件历史」查看）
        </Typography.Text>
      );
    }
    if (h.missingPath) {
      return (
        <Typography.Text type="secondary" data-testid="blame-changes-missing-hint">
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
        <Typography.Text type="secondary" data-testid="blame-latest-missing-hint">
          该提交的版本里没有这个路径（可能当时它叫别的名字，或还没有这个文件），无法与当前版本对比
        </Typography.Text>
      );
    }
    return null;
  }

  /** 差异正文：提示行优先于数据状态（它不依赖取数）；随后错误 → 加载 → 差异视图 */
  function diffBody(channel: BlameDiffChannel, key: 'changes' | 'latest', hint: React.ReactNode): React.ReactNode {
    if (hint !== null) return hint;
    if (channel.error !== undefined) {
      return (
        <Typography.Text type="danger" data-testid={`blame-${key}-error`}>
          {channel.error}
        </Typography.Text>
      );
    }
    if (channel.versions === undefined || channel.loading === true) {
      return <Spin data-testid={`blame-${key}-loading`} />;
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
