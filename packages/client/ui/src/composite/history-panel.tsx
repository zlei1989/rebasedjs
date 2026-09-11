/**
 * 文件历史面板：文件路径头 + 条目列表（短哈希 + subject + 作者 + 日期），
 *  整行可点击 → onSelectCommit（容器接「选中该提交」）；双击 → onOpenDiff（hash + parents——根提交降级由容器判定）；
 *  行内「Annotate Revision」按钮 → onAnnotate（跳到该版本溯源页）。空态 EmptyState；行样式沿既有面板约定。
 *  条目列表走 antd Listy（6.6.0 起）：行容器/悬停底色由组件负责；行级 Tooltip 按产品口径不挂，
 *  故原本驱动行气泡的 rowHover/actionHover 状态一并删掉（行内按钮的 Tooltip 保留）。
 *  纯受控（file/entries/loading/error）；ui 不调接口，数据与回调由调用方容器注入。
 */
import { Button, Card, Flex, Listy, Spin, Tooltip, Typography } from 'antd';
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
    // 行内边距（原 `padding: '4px 0'`）留在**可点元素自身**：下沉到 Listy 的 `styles.item` 会让那圈内边距
    // 落在包装 div 上（不属本元素命中区，点在内边距上不触发行选中）。
    // 行级 Tooltip 按产品口径不挂（原 rowHover/actionHover 受控气泡随之删除）。
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
        // 操作区容器只做布局：display:inline-flex 是为了让外层 span 不参与行高计算
        //（inline 行盒会顶高整行，破坏既有布局）；点击仍由按钮自身处理（按钮内已 stopPropagation，行为不变）。
        <span style={{ display: 'inline-flex' }}>
          <Tooltip title="打开该提交版本的逐行溯源（Annotate），查看每行的最后修改提交">
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
          </Tooltip>
        </span>
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
          {/* 条目列表走 antd Listy（6.6.0 起的列表组件，取代老 List）：容器/行结构/悬停底色由组件负责，
              调用方只给数据与行内容，不再手写 flex 行。原实现无虚拟滚动/加载更多分页语义，故不启用 virtual/height。 */}
          <Listy
            items={entries}
            rowKey={(entry) => entry.hash}
            itemRender={(entry, index) => (
              <HistoryRow
                entry={entry}
                index={index}
                onSelectCommit={onSelectCommit}
                onOpenDiff={onOpenDiff}
                onAnnotate={onAnnotate}
              />
            )}
            // 行内边距沿用改造前的 4px 0（Listy 默认 12px 16px）；下边框与悬停底色走组件默认样式
            styles={{ item: { padding: '4px 0' } }}
          />
        </Card>
      )}
    </Flex>
  );
}
