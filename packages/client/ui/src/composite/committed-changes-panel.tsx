/**
 * Committed Changes 浏览器（对照平台 CommittedChangesBrowser 的平铺版）：
 *  提交列表左栏 + 选中提交的文件列表右栏（状态徽标 A/M/D/R + renameFrom）。
 *  文件点击 → onOpenFile(path, hash)——from/to 差值端点映射由容器负责（约定 `${hash}~1` → hash）。
 *  「加载更多」为组件内简单交互：page 数据由容器注入，本组件只显示与回调（onLoadMore/loadingMore）。
 *  纯受控（page/selectedHash + 各回调）；ui 不调接口，数据与回调由调用方容器注入。
 */
import { Button, Card, Flex, Tag, Typography } from 'antd';
import type { CommittedEntry, CommittedFileStatus, CommittedPage } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface CommittedChangesPanelProps {
  page?: CommittedPage;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  selectedHash?: string;
  onSelectCommit?: (hash: string) => void;
  /** 文件点击载荷：路径 + 所属提交完整哈希（容器接 diff 端点；from/to 由容器解析 `${hash}~1`） */
  onOpenFile?: (path: string, hash: string) => void;
}

/** name-status 状态码 → 徽标配色：A 新增绿 / M 修改蓝 / D 删除红 / R 重命名紫 / C 复制青 / T 类型变更橙 */
const STATUS_COLORS: Record<CommittedFileStatus, string> = {
  A: 'green',
  M: 'blue',
  D: 'red',
  R: 'purple',
  C: 'cyan',
  T: 'orange',
};

/** 提交行：短哈希 + subject（弹性）+ 作者 + 日期；整行点击 → onSelectCommit 完整哈希；命中 selectedHash 时底色高亮 */
function CommitRow({
  entry,
  index,
  selected,
  onSelectCommit,
}: {
  entry: CommittedEntry;
  index: number;
  selected: boolean;
  onSelectCommit?: (hash: string) => void;
}): React.ReactNode {
  return (
    <Flex
      data-testid={`committed-entry-${index}`}
      align="center"
      gap={8}
      style={{
        padding: '4px 8px',
        cursor: onSelectCommit ? 'pointer' : undefined,
        backgroundColor: selected ? '#e6f4ff' : undefined,
      }}
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

/** 文件行：状态徽标 + （重命名时原名 →）+ 路径；点击 → onOpenFile(path, 所属提交 hash) */
function FileRow({
  file,
  index,
  hash,
  onOpenFile,
}: {
  file: CommittedEntry['files'][number];
  index: number;
  hash: string;
  onOpenFile?: (path: string, hash: string) => void;
}): React.ReactNode {
  return (
    <Flex
      data-testid={`committed-file-${index}`}
      align="center"
      gap={8}
      style={{ padding: '4px 0', cursor: onOpenFile ? 'pointer' : undefined }}
      onClick={() => onOpenFile?.(file.path, hash)}
    >
      <Tag color={STATUS_COLORS[file.status]} style={{ flexShrink: 0, marginInlineEnd: 8 }}>
        {file.status}
      </Tag>
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

export function CommittedChangesPanel({
  page,
  onLoadMore,
  loadingMore,
  selectedHash,
  onSelectCommit,
  onOpenFile,
}: CommittedChangesPanelProps): React.ReactNode {
  const entries = page?.entries ?? [];
  // 右栏只展示当前选中提交的文件（selectedHash 由容器受控；未命中视为未选中）
  const selected = selectedHash ? entries.find((e) => e.hash === selectedHash) : undefined;

  return (
    <Flex vertical gap={8} style={{ padding: 16 }}>
      {entries.length === 0 ? (
        <EmptyState title="暂无提交记录" />
      ) : (
        <Flex gap={16} align="flex-start">
          <Card size="small" title={`提交列表（${entries.length}）`} style={{ flex: 1, minWidth: 0 }}>
            <Flex vertical>
              {entries.map((entry, index) => (
                <CommitRow
                  key={entry.hash}
                  entry={entry}
                  index={index}
                  selected={entry.hash === selectedHash}
                  onSelectCommit={onSelectCommit}
                />
              ))}
              {/* 「加载更多」：仅在 hasMore 时出现；loading 态由 loadingMore 驱动（数据注入与回调由容器持有） */}
              {page?.hasMore ? (
                <Button
                  data-testid="committed-load-more"
                  loading={loadingMore}
                  onClick={onLoadMore}
                  style={{ marginTop: 8 }}
                >
                  加载更多
                </Button>
              ) : null}
            </Flex>
          </Card>
          <Card
            size="small"
            title={selected ? `变更文件（${selected.files.length}）` : '变更文件'}
            style={{ flex: 2, minWidth: 0 }}
          >
            {!selected ? (
              <EmptyState title="选择一个提交查看变更文件" />
            ) : selected.files.length === 0 && selected.parents.length > 1 ? (
              /* 合并提交：git log --name-status 默认不输出 merge 的文件变更（合并结果按 diff-tree 展示），
                 空文件列表以 merge 提示替代误导性的「无文件变更」（终审 Minor） */
              <EmptyState title="合并提交" description="git 对合并提交默认不列出文件变更；请到日志页查看合并结果" />
            ) : selected.files.length === 0 ? (
              <EmptyState title="该提交无文件变更" />
            ) : (
              <Flex vertical>
                {selected.files.map((file, index) => (
                  <FileRow
                    key={`${file.path}-${index}`}
                    file={file}
                    index={index}
                    hash={selected.hash}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </Flex>
            )}
          </Card>
        </Flex>
      )}
    </Flex>
  );
}
