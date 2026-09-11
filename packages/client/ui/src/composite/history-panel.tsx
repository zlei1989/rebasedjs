/**
 * 文件历史面板：文件路径头 + 条目列表（短哈希 + subject + 作者 + 日期），
 *  整行可点击 → onSelectCommit（容器接「选中该提交」）；双击 → onOpenDiff（hash + parents——根提交降级由容器判定）；
 *  行内「Annotate Revision」按钮 → onAnnotate（跳到该版本溯源页）。空态 EmptyState；行样式沿既有面板约定。
 *  纯受控（file/entries/loading/error）；ui 不调接口，数据与回调由调用方容器注入。
 */
import { useState } from 'react';
import { Button, Card, Flex, Spin, Tooltip, Typography } from 'antd';
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
  /** 悬停中的整行：整行可点需给悬停反馈的气泡，但只在指针真正落在行上时弹（见 clickable/open 注释） */
  const [rowHover, setRowHover] = useState(false);
  /** 悬停中的行内操作区（Annotate 按钮）：行气泡与按钮气泡互斥，否则两个气泡会同时弹出 */
  const [actionHover, setActionHover] = useState(false);
  /** 行是否真的有可点行为：缺省（未注入回调）时不给行气泡，避免提示一个点了没反应的区域 */
  const clickable = onSelectCommit !== undefined || onOpenDiff !== undefined;
  return (
    // 整行可点 + 行内自带 Annotate 按钮 → 行 Tooltip 用受控 open：
    // 仅当指针在行上、且不在行内操作区上时才弹（动作区自带气泡），参考 repo-page.tsx 的 hoverId / actionHoverId 写法
    <Tooltip
      open={clickable && rowHover && !actionHover}
      title={clickable ? '单击选中该提交，双击打开它与父提交的差异对比' : undefined}
    >
      <Flex
        data-testid={`history-entry-${index}`}
        align="center"
        gap={8}
        style={{ padding: '4px 0', cursor: 'pointer' }}
        // 纯悬停反馈（不改变点击行为）：驱动上面受控的行气泡
        onMouseEnter={() => setRowHover(true)}
        onMouseLeave={() => setRowHover(false)}
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
          // 操作区容器只承接「悬停即抑制行气泡」：点击仍由按钮自身处理（按钮内已 stopPropagation，行为不变）。
          // display:inline-flex 是为了让外层 span 不参与行高计算（inline 行盒会顶高整行，破坏既有布局）
          <span
            style={{ display: 'inline-flex' }}
            onMouseEnter={() => setActionHover(true)}
            onMouseLeave={() => setActionHover(false)}
          >
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
    </Tooltip>
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
