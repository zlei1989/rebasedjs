/**
 * Committed Changes 浏览器（对照平台 CommittedChangesBrowser 的平铺版）：
 *  提交列表左栏 + 选中提交的变更文件【目录树】右栏（目录节点可折叠、文件名叶子带状态徽标 A/M/D/R + renameFrom）。
 *  文件点击 → onOpenFile(path, hash)——from/to 差值端点映射由容器负责（约定 `${hash}~1` → hash）。
 *  「加载更多」为组件内简单交互：page 数据由容器注入，本组件只显示与回调（onLoadMore/loadingMore）。
 *  纯受控（page/selectedHash + 各回调）；ui 不调接口，数据与回调由调用方容器注入。
 */
import { useState } from 'react';
import { Button, Card, Flex, Typography, theme } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, FolderOutlined } from '@ant-design/icons';
import type { CommittedEntry, CommittedFileStatus, CommittedPage } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { CommittedStatusTag } from '../domain/committed-status';
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

/** 目录树节点：dir=目录（可折叠，children 为子节点）；file=文件叶子（status/renameFrom 随文件）
 *  fileIndex 为文件在原 files 数组中的下标（叶子 testid 沿用 flat 时代语义） */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  status?: CommittedFileStatus;
  renameFrom?: string;
  fileIndex?: number;
  children?: FileTreeNode[];
}

/**
 * 平铺路径 → 目录树（纯函数，容器/测试复用）：按 '/' 分段建目录节点（叶子目录照建），文件挂到所属目录；
 * 同级排序：目录排文件前、各自按名称（平台文件树同语义）。
 */
export function buildFileTree(files: CommittedEntry['files']): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();
  files.forEach((file, index) => {
    const segments = file.path.split('/');
    const leafName = segments.pop() ?? file.path;
    let parent = roots;
    let acc = '';
    for (const seg of segments) {
      acc = acc === '' ? seg : `${acc}/${seg}`;
      let node = dirMap.get(acc);
      if (node === undefined) {
        node = { name: seg, path: acc, type: 'dir', children: [] };
        dirMap.set(acc, node);
        parent.push(node);
      }
      parent = node.children ?? [];
    }
    parent.push({
      name: leafName,
      path: file.path,
      type: 'file',
      ...(file.status !== undefined ? { status: file.status } : {}),
      ...(file.renameFrom !== undefined ? { renameFrom: file.renameFrom } : {}),
      fileIndex: index,
    });
  });
  const sortNodes = (nodes: FileTreeNode[]): void => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    nodes.forEach((n) => n.children !== undefined && sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

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
  // 选中底色走主题 token（controlItemBgActive：明亮 #e6f4ff / 暗色 #111a2c），不再硬编码明亮专用色
  const { token } = theme.useToken();
  return (
    <Flex
      data-testid={`committed-entry-${index}`}
      align="center"
      gap={8}
      style={{
        padding: '4px 8px',
        cursor: onSelectCommit ? 'pointer' : undefined,
        backgroundColor: selected ? token.controlItemBgActive : undefined,
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

/** 目录树节点渲染：目录行（叶子折叠图标 + 名称，点击折叠/展开）；文件叶子（状态徽标 + 原名→ + 名称，点击回调）
 *  文件 testid 沿用 committed-file-<原数组下标>（向后兼容既有断言）；目录 testid committed-dir-<路径> */
function TreeNodeRow({
  node,
  depth,
  hash,
  collapsed,
  onToggle,
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  hash: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile?: (path: string, hash: string) => void;
}): React.ReactNode {
  if (node.type === 'dir') {
    const open = !collapsed.has(node.path);
    return (
      <>
        <Flex
          data-testid={`committed-dir-${node.path}`}
          align="center"
          gap={4}
          style={{ padding: '4px 0', paddingLeft: depth * 16, cursor: 'pointer' }}
          onClick={() => onToggle(node.path)}
        >
          {open ? <CaretDownOutlined style={{ fontSize: 10 }} /> : <CaretRightOutlined style={{ fontSize: 10 }} />}
          <FolderOutlined />
          <Typography.Text>{node.name}</Typography.Text>
        </Flex>
        {open
          ? (node.children ?? []).map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              hash={hash}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))
          : null}
      </>
    );
  }
  return (
    <Flex
      data-testid={`committed-file-${node.fileIndex ?? node.path}`}
      align="center"
      gap={8}
      style={{ padding: '4px 0', paddingLeft: depth * 16, cursor: onOpenFile ? 'pointer' : undefined }}
      onClick={() => onOpenFile?.(node.path, hash)}
    >
      {node.status !== undefined ? <CommittedStatusTag status={node.status} /> : null}
      {node.renameFrom ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {node.renameFrom} →
        </Typography.Text>
      ) : null}
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {node.name}
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
  // 目录树折叠态：Set<目录路径>（缺省全展开——平台文件树默认展开语义）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

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
                {/* 目录树：平铺路径经 buildFileTree 组织（目录可折叠；文件叶子保留原数组下标 testid） */}
                {buildFileTree(selected.files).map((node) => (
                  <TreeNodeRow
                    key={node.path}
                    node={node}
                    depth={0}
                    hash={selected.hash}
                    collapsed={collapsed}
                    onToggle={toggleDir}
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
