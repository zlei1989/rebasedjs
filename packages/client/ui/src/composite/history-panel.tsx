/**
 * 文件历史面板：文件路径头 + 条目列表（短哈希 + subject + 作者 + 日期），
 *  整行可点击 → onSelectCommit（容器接「选中该提交」）；双击 → onOpenDiff（hash + parents——根提交降级由容器判定）；
 *  行内「Annotate Revision」按钮 → onAnnotate（跳到该版本溯源页）。空态 EmptyState；行样式沿既有面板约定。
 *  纯受控（file/entries/loading/error）；ui 不调接口，数据与回调由调用方容器注入。
 */
import { Button, Card, Flex, Spin, Typography } from 'antd';
import type { FileHistoryEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface HistoryPanelProps {
  file: string;
  entries?: FileHistoryEntry[];
  loading?: boolean;
  error?: string;
  onSelectCommit?: (hash: string) => void;
  /** 双击条目（hash + 父提交数组——容差判定根提交 diff 降级）；缺省不绑定双击 */
  onOpenDiff?: (hash: string, parents: string[]) => void;
  /** 行内「Annotate Revision」回调（hash）；缺省不渲染该按钮 */
  onAnnotate?: (hash: string) => void;
}

/** 历史条目行：短哈希徽标 + subject（弹性）+ 作者 + 日期 + Annotate 按钮；单击 → onSelectCommit、双击 → onOpenDiff */
function HistoryRow({
  entry,
  index,
  onSelectCommit,
  onOpenDiff,
  onAnnotate,
}: {
  entry: FileHistoryEntry;
  index: number;
  onSelectCommit?: (hash: string) => void;
  onOpenDiff?: (hash: string, parents: string[]) => void;
  onAnnotate?: (hash: string) => void;
}): React.ReactNode {
  return (
    <Flex
      data-testid={`history-entry-${index}`}
      align="center"
      gap={8}
      style={{ padding: '4px 0', cursor: 'pointer' }}
      onClick={() => onSelectCommit?.(entry.hash)}
      onDoubleClick={() => onOpenDiff?.(entry.hash, entry.parents)}
    >
      <Typography.Text code style={{ flexShrink: 0 }}>
        {entry.shortHash}
      </Typography.Text>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {entry.subject}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {entry.author}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(entry.dateIso)}
      </Typography.Text>
      {onAnnotate !== undefined ? (
        <Button
          size="small"
          type="text"
          data-testid={`history-annotate-${index}`}
          onClick={(e) => {
            e.stopPropagation();
            onAnnotate(entry.hash);
          }}
        >
          Annotate
        </Button>
      ) : null}
    </Flex>
  );
}

export function HistoryPanel({
  file,
  entries,
  loading,
  error,
  onSelectCommit,
  onOpenDiff,
  onAnnotate,
}: HistoryPanelProps): React.ReactNode {
  return (
    <Flex vertical gap={8} style={{ padding: 16 }}>
      <Typography.Text code data-testid="history-file">
        {file}
      </Typography.Text>
      {loading ? (
        <Spin data-testid="history-loading" />
      ) : error ? (
        <Typography.Text type="danger" data-testid="history-error">
          {error}
        </Typography.Text>
      ) : !entries || entries.length === 0 ? (
        <EmptyState title="暂无历史记录" />
      ) : (
        <Card size="small" title={`文件历史（${entries.length}）`}>
          <Flex vertical>
            {entries.map((entry, index) => (
              <HistoryRow
                key={entry.hash}
                entry={entry}
                index={index}
                onSelectCommit={onSelectCommit}
                onOpenDiff={onOpenDiff}
                onAnnotate={onAnnotate}
              />
            ))}
          </Flex>
        </Card>
      )}
    </Flex>
  );
}
