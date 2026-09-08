/**
 * 溯源视图（对照 GitAnnotationProvider 的展示面）：
 *  文件路径头 + 行列表（行号 | 作者 | 日期 | 内容），行按 BlameLine 渲染，
 *  hash 短名徽标可点击（onOpenCommit 可选——点开 LogPage 选中该提交，容器接线）。
 *  行内联动（对照 gutter 右键动作，Web 以行内按钮承载）：「差异」→ onShowDiff(hash)（DiffPage from/to）、
 *  「历史」→ onShowInHistory(file)（HistoryPanel）、「受影响」→ Show All Affected（#34）：
 *  打开该提交全量变更文件 Modal（对照平台「Paths affected in <revision>」对话框——ChangeListViewerDialog，
 *  数据由容器经 useCommitFiles 条件拉取，本组件只受控渲染）。纯受控（file/lines/loading/error）；
 *  ui 不调接口，数据与回调由调用方容器注入。
 */
import { Button, Flex, Modal, Spin, Typography } from 'antd';
import type { BlameLine, CommittedEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { CommittedStatusTag } from '../domain/committed-status';
import { formatCommitDate } from '../domain/format';

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
      <Button
        type="link"
        size="small"
        style={{ padding: 0, flexShrink: 0 }}
        data-testid={`blame-hash-${line.lineno}`}
        onClick={() => onOpenCommit?.(line.hash)}
      >
        {line.shortHash}
      </Button>
      {onShowDiff !== undefined ? (
        <Button
          size="small"
          type="text"
          style={{ flexShrink: 0 }}
          data-testid={`blame-diff-${line.lineno}`}
          onClick={() => onShowDiff(line.hash, line.parents)}
        >
          差异
        </Button>
      ) : null}
      {onShowInHistory !== undefined ? (
        <Button
          size="small"
          type="text"
          style={{ flexShrink: 0 }}
          data-testid={`blame-history-${line.lineno}`}
          onClick={() => onShowInHistory(file)}
        >
          历史
        </Button>
      ) : null}
      {onShowAffected !== undefined ? (
        <Button
          size="small"
          type="text"
          style={{ flexShrink: 0 }}
          data-testid={`blame-affected-${line.lineno}`}
          onClick={() => onShowAffected(line.hash)}
        >
          受影响
        </Button>
      ) : null}
      <Typography.Text style={{ width: 120, flexShrink: 0 }} ellipsis>
        {line.author}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(line.dateIso)}
      </Typography.Text>
      <Typography.Text style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }} ellipsis>
        {line.content}
      </Typography.Text>
    </Flex>
  );
}

/** 受影响文件行：状态徽标 + （重命名时原名 →）+ 路径；点击 → onOpenAffectedFile(path)（缺省只读） */
function AffectedFileRow({
  file,
  index,
  onOpenFile,
}: {
  file: CommittedEntry['files'][number];
  index: number;
  onOpenFile?: (path: string) => void;
}): React.ReactNode {
  return (
    <Flex
      data-testid={`affected-file-${index}`}
      align="center"
      gap={8}
      style={{ padding: '4px 0', cursor: onOpenFile ? 'pointer' : undefined }}
      onClick={() => onOpenFile?.(file.path)}
    >
      <CommittedStatusTag status={file.status} />
      {file.renameFrom ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {file.renameFrom} →
        </Typography.Text>
      ) : null}
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {file.path}
      </Typography.Text>
    </Flex>
  );
}

/** 受影响文件 Modal（Show All Affected #34）：提交元信息头 + 全量文件清单；loading/error/空态分派 */
function AffectedFilesModal({
  hash,
  entry,
  loading,
  error,
  onClose,
  onOpenFile,
}: {
  hash: string;
  entry?: CommittedEntry | null;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
  onOpenFile?: (path: string) => void;
}): React.ReactNode {
  return (
    <Modal
      title={`受影响文件（${entry?.shortHash ?? hash.slice(0, 7)}）`}
      open={hash !== ''}
      footer={null}
      width={720}
      onCancel={onClose}
    >
      {loading ? (
        <Spin data-testid="affected-loading" />
      ) : error ? (
        <Typography.Text type="danger" data-testid="affected-error">
          {error}
        </Typography.Text>
      ) : entry === null || entry === undefined || entry.files.length === 0 ? (
        entry !== null && entry !== undefined && entry.parents.length > 1 ? (
          /* 合并提交：git log--name-status 默认不展开 merge 变更（与 CommittedChangesPanel 同语义提示） */
          <EmptyState title="合并提交" description="git 对合并提交默认不列出文件变更；请到日志页查看合并结果" />
        ) : (
          <EmptyState title="该提交无文件变更" />
        )
      ) : (
        <Flex vertical>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {entry.subject} · {entry.author} · {formatCommitDate(entry.dateIso)}
          </Typography.Text>
          <Flex vertical>
            {entry.files.map((file, index) => (
              <AffectedFileRow key={`${file.path}-${index}`} file={file} index={index} onOpenFile={onOpenFile} />
            ))}
          </Flex>
        </Flex>
      )}
    </Modal>
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
  return (
    <Flex vertical gap={8} style={{ padding: 16 }}>
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
    </Flex>
  );
}
