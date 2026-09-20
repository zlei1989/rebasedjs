/**
 * 溯源视图（对照 GitAnnotationProvider 的展示面）：
 *  文件路径头 + 行列表（行号 | 作者 | 日期 | 内容），行按 BlameLine 渲染，
 *  hash 短名徽标可点击（onOpenCommit 可选——点开 LogPage 选中该提交，容器接线）。
 *  行内联动（对照 gutter 右键动作，Web 以行内按钮承载）：「差异」→ onShowDiff(hash)（DiffPage from/to）、
 *  「历史」→ onShowInHistory(file)（HistoryPanel）、「受影响」→ Show All Affected（#34）：
 *  打开该提交全量变更文件弹窗（对照平台「Paths affected in <revision>」对话框——ChangeListViewerDialog，
 *  弹窗实现已提为 composite/affected-files-modal；数据由容器经 useCommitFiles 条件拉取，本组件只受控渲染）。
 *  纯受控（file/lines/loading/error）；ui 不调接口，数据与回调由调用方容器注入。
 *  列表/Listy 边界：「受影响文件清单」是同质条目的列表 → 在 affected-files-modal 内走 antd Listy（6.6.0 起）；
 *  溯源正文行（blame-line-*，等宽字体代码行）是代码正文渲染而非条目列表，保持手写行不迁 Listy。
 */
import { Button, Flex, Spin, Tooltip, Typography } from 'antd';
import type { BlameLine, CommittedEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { PageShell } from '../base/page-shell';
import { formatCommitDate } from '../domain/format';
import { AffectedFilesModal } from './affected-files-modal';

export interface BlameViewProps {
  file: string;
  lines?: BlameLine[];
  loading?: boolean;
  error?: string;
  onOpenCommit?: (hash: string) => void;
  /** 行内「差异」回调（hash——DiffPage from/to 导航；根提交降级由容器判定）；缺省不渲染该按钮 */
  onShowDiff?: (hash: string, parents: string[]) => void;
  /** 行内「历史」回调（file——HistoryPanel）；缺省不渲染该按钮 */
  onShowInHistory?: (file: string) => void;
  /** 行内「受影响」回调（hash——Show All Affected #34：打开该提交全量变更文件 Modal）；缺省不渲染该按钮 */
  onShowAffected?: (hash: string) => void;
  /** 受影响文件 Modal 受控打开键（容器据此条件拉取；'' / undefined = 关闭） */
  affectedHash?: string;
  /** 受影响文件 Modal 数据（容器经 useCommitFiles 条件拉取；null 未就绪 → loading 态） */
  affectedEntry?: CommittedEntry | null;
  affectedLoading?: boolean;
  affectedError?: string | null;
  /** 关闭受影响文件 Modal（容器清空 hash 停止拉取） */
  onCloseAffected?: () => void;
  /** Modal 内文件点击（path——容器接 diff：from=父哈希、to=该提交）；缺省行只读 */
  onOpenAffectedFile?: (path: string) => void;
}

/** 溯源行：行号 | hash 短名徽标（点击 → onOpenCommit 完整哈希）| 作者 | 日期 | 内容（等宽字体对齐代码展示）+ 联动按钮 */
function BlameRow({
  line,
  onOpenCommit,
  onShowDiff,
  onShowInHistory,
  onShowAffected,
  file,
}: {
  line: BlameLine;
  onOpenCommit?: (hash: string) => void;
  onShowDiff?: (hash: string, parents: string[]) => void;
  onShowInHistory?: (file: string) => void;
  onShowAffected?: (hash: string) => void;
  file: string;
}): React.ReactNode {
  return (
    <Flex data-testid={`blame-line-${line.lineno}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text type="secondary" style={{ width: 48, textAlign: 'right', flexShrink: 0 }}>
        {line.lineno}
      </Typography.Text>
      {/* hash 短名即操作入口：点了会跳到日志页并选中该提交（不是纯展示文本）。
          未接线 onOpenCommit 时该按钮无行为 → 去掉提示，避免承诺做不到的事 */}
      <Tooltip title={onOpenCommit ? '在提交日志中定位该提交并选中它（只做导航，不改动工作区）' : undefined}>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, flexShrink: 0 }}
          data-testid={`blame-hash-${line.lineno}`}
          onClick={() => onOpenCommit?.(line.hash)}
        >
          {line.shortHash}
        </Button>
      </Tooltip>
      {onShowDiff !== undefined ? (
        /* 「差异」：说明对比的两侧（该提交 vs 其父提交）+ 去向（新标签页，原页不被顶掉），不点开猜不到对比基准 */
        <Tooltip title="对比该提交与其父提交的差异文件（新标签页打开，根提交无父版本时容器会降级处理）">
          <Button
            size="small"
            type="text"
            style={{ flexShrink: 0 }}
            data-testid={`blame-diff-${line.lineno}`}
            onClick={() => onShowDiff(line.hash, line.parents)}
          >
            差异
          </Button>
        </Tooltip>
      ) : null}
      {onShowInHistory !== undefined ? (
        /* 「历史」：作用对象是当前文件（而非某一次提交），与「差异」区分 */
        <Tooltip title="查看当前文件的提交历史列表（逐次改动记录）">
          <Button
            size="small"
            type="text"
            style={{ flexShrink: 0 }}
            data-testid={`blame-history-${line.lineno}`}
            onClick={() => onShowInHistory(file)}
          >
            历史
          </Button>
        </Tooltip>
      ) : null}
      {onShowAffected !== undefined ? (
        /* 「受影响」：弹出该提交的全量文件清单（Show All Affected） */
        <Tooltip title="打开该提交改动的全部文件清单；合并提交默认不列出文件变更">
          <Button
            size="small"
            type="text"
            style={{ flexShrink: 0 }}
            data-testid={`blame-affected-${line.lineno}`}
            onClick={() => onShowAffected(line.hash)}
          >
            受影响
          </Button>
        </Tooltip>
      ) : null}
      <Typography.Text style={{ width: 120, flexShrink: 0 }} ellipsis>
        {line.author}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
        {formatCommitDate(line.dateIso)}
      </Typography.Text>
      <Typography.Text style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }} ellipsis>
        {line.content}
      </Typography.Text>
    </Flex>
  );
}

export function BlameView({
  file,
  lines,
  loading,
  error,
  onOpenCommit,
  onShowDiff,
  onShowInHistory,
  onShowAffected,
  affectedHash,
  affectedEntry,
  affectedLoading,
  affectedError,
  onCloseAffected,
  onOpenAffectedFile,
}: BlameViewProps): React.ReactNode {
  // 根容器：本组件被 blame 页嵌在宿主布局根内（apps 侧页面自带 flex 根），故传 density="default" 只豁免密度。
  // gap/padding 照抄既有值 8/16（PageShell 默认不落 style，不传会静默丢掉内距与行距）。
  return (
    <PageShell density="default" gap={8} padding={16}>
      <Typography.Text code data-testid="blame-file">
        {file}
      </Typography.Text>
      {loading ? (
        <Spin data-testid="blame-loading" />
      ) : error ? (
        <Typography.Text type="danger" data-testid="blame-error">
          {error}
        </Typography.Text>
      ) : !lines || lines.length === 0 ? (
        <EmptyState title="暂无溯源信息" />
      ) : (
        /* 溯源正文行**不迁 Listy**（有意保留手写行）：这是「代码正文」逐行渲染而非同质条目列表——
           行要按 BlameLine 与内容列严格对齐（等宽字体 + 行号定宽），Listy 行容器会加下边框/悬停底色/统一内边距，
           会把代码阅读面切成一条条「列表项」，且虚拟化行容器与代码行的对齐语义无关。 */
        <Flex vertical>
          {lines.map((line) => (
            <BlameRow
              key={line.lineno}
              line={line}
              file={file}
              onOpenCommit={onOpenCommit}
              onShowDiff={onShowDiff}
              onShowInHistory={onShowInHistory}
              onShowAffected={onShowAffected}
            />
          ))}
        </Flex>
      )}
      {onShowAffected !== undefined ? (
        <AffectedFilesModal
          hash={affectedHash ?? ''}
          entry={affectedEntry}
          loading={affectedLoading}
          error={affectedError}
          onClose={onCloseAffected}
          onOpenFile={onOpenAffectedFile}
        />
      ) : null}
    </PageShell>
  );
}
