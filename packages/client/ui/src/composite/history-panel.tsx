/**
 * 文件历史面板：文件路径头 + 条目列表（短哈希 + subject + 作者 + 日期），
 *  整行可点击 → onSelectCommit（容器接「选中该提交」）；空态 EmptyState；行样式沿既有面板约定。
 *  纯受控（file/entries/loading/error）；ui 不调接口，数据与回调由调用方容器注入。
 */
import { Card, Flex, Spin, Typography } from 'antd';
import type { FileHistoryEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface HistoryPanelProps {
  file: string;
  entries?: FileHistoryEntry[];
  loading?: boolean;
  error?: string;
  onSelectCommit?: (hash: string) => void;
}

/** 历史条目行：短哈希徽标 + subject（弹性）+ 作者 + 日期；整行点击 → onSelectCommit 完整哈希 */
function HistoryRow({
  entry,
  index,
  onSelectCommit,
}: {
  entry: FileHistoryEntry;
  index: number;
  onSelectCommit?: (hash: string) => void;
}): React.ReactNode {
  return (
    <Flex
      data-testid={`history-entry-${index}`}
      align="center"
      gap={8}
      style={{ padding: '4px 0', cursor: 'pointer' }}
      onClick={() => onSelectCommit?.(entry.hash)}
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
    </Flex>
  );
}

export function HistoryPanel({ file, entries, loading, error, onSelectCommit }: HistoryPanelProps): React.ReactNode {
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
              <HistoryRow key={entry.hash} entry={entry} index={index} onSelectCommit={onSelectCommit} />
            ))}
          </Flex>
        </Card>
      )}
    </Flex>
  );
}
