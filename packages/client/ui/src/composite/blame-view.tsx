/**
 * 溯源视图（对照 GitAnnotationProvider 的展示面）：
 *  文件路径头 + 行列表（行号 | 作者 | 日期 | 内容），行按 BlameLine 渲染，
 *  hash 短名徽标可点击（onOpenCommit 可选——点开 LogPage 选中该提交，容器接线）。
 *  行内联动（对照 gutter 右键动作，Web 以行内按钮承载）：「差异」→ onShowDiff(hash)（DiffPage from/to）、
 *  「历史」→ onShowInHistory(file)（HistoryPanel）。纯受控（file/lines/loading/error）；
 *  ui 不调接口，数据与回调由调用方容器注入。
 */
import { Button, Flex, Spin, Typography } from 'antd';
import type { BlameLine } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
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
}

/** 溯源行：行号 | hash 短名徽标（点击 → onOpenCommit 完整哈希）| 作者 | 日期 | 内容（等宽字体对齐代码展示）+ 联动按钮 */
function BlameRow({
  line,
  onOpenCommit,
  onShowDiff,
  onShowInHistory,
  file,
}: {
  line: BlameLine;
  onOpenCommit?: (hash: string) => void;
  onShowDiff?: (hash: string, parents: string[]) => void;
  onShowInHistory?: (file: string) => void;
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

export function BlameView({
  file,
  lines,
  loading,
  error,
  onOpenCommit,
  onShowDiff,
  onShowInHistory,
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
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}
