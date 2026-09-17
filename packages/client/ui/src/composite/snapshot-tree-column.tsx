/**
 * 快照文件树列：**只有文件树**的那一块。
 * 给谁用：日志页就地快照栏的「文件（N）」标签页（见 composite/snapshot-tabs）——
 *   快照栏把「文件树」与「文件内容」合并成一条标签栏，树要嵌进标签页里，故这里只产出**树本身**：
 *   标签名（「文件（N）」）在标签栏上，路径与动作在文件标签页的路径栏里，本组件不带表头。
 * 为什么不用 Card 包：Card 自带边框与内边距，而标签页里要「去掉边框、更紧凑」；
 *   留白与滚动交给调用方（标签页的宿主 Flex）。
 * 历史：本模块原名 composite/browse-panel，整页形态 `/repos/:id/browse`（左右两栏）已按用户口径删除——
 *   该页在应用内无任何入口（详情面板「浏览快照」开的是就地快照栏，见 composite/log-page）。
 */
import { Spin, Tag, Typography } from 'antd';
import type { BrowseEntry } from '@rebased/contracts';
import { useMemo } from 'react';
import { EmptyState } from '../base/empty-state';
import { FileTree, type FileTreeNode } from '../base/file-tree';
import { buildDirectoryTree } from '../domain/directory-tree';

/** 条目形态徽标：子模块（gitlink）与符号链接仅作标注，不参与内容预览 */
function entryBadge(entry: BrowseEntry): React.ReactNode {
  if (entry.type === 'commit') return <Tag color="default">子模块</Tag>;
  if (entry.mode === '120000') return <Tag color="default">链接</Tag>;
  return null;
}

/**
 * ls-tree 条目 → FileTree 节点：目录聚合走 buildDirectoryTree（与 CommittedChangesPanel 同源），
 * 叶子按条目形态覆写 selectable 与标题徽标（子模块不可选中、blob 可选中、符号链接只标注）。
 */
export function snapshotTreeNodes(entries: BrowseEntry[]): FileTreeNode[] {
  const tree = buildDirectoryTree(entries.map((e) => e.path));
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const enrich = (list: FileTreeNode[]): FileTreeNode[] =>
    list.map((node) => {
      if (node.isLeaf && node.key !== undefined) {
        const entry = byPath.get(node.key);
        if (entry === undefined) return node;
        return {
          ...node,
          selectable: entry.type === 'blob',
          title: (
            <span>
              {node.title}
              {entryBadge(entry)}
            </span>
          ),
        };
      }
      return node.children !== undefined ? { ...node, children: enrich(node.children) } : node;
    });
  return enrich(tree);
}

/** 树的第一层目录键：作为初始展开集（大仓库不整树展开） */
export function topLevelDirKeys(nodes: FileTreeNode[]): string[] {
  return nodes.filter((n) => n.children !== undefined && n.children.length > 0).map((n) => n.key);
}

export interface SnapshotTreeColumnProps {
  /**
   * 浏览目标版本：只用作 FileTree 的**重挂载键**——rev 变了要让树回到初始展开态
   * （FileTree 的初始展开仅首挂载生效，见 base/file-tree 的文件头）。
   * 版本号本身的展示不在本组件（「文件（N）」在标签栏上）。
   * **可选**：调用方若已把版本用作外层的 `key`（如快照标签栏的 key = 版本），树随外层一起重挂载，
   * 这里不传即可，行为不变。
   */
  revKey?: string;
  entries?: BrowseEntry[];
  loading?: boolean;
  error?: string;
  /** 当前选中文件路径（受控；再点同一个文件由调用方处理为「收起内容」） */
  selectedPath?: string;
  onSelectFile?: (path: string) => void;
}

export function SnapshotTreeColumn({
  revKey,
  entries,
  loading,
  error,
  selectedPath,
  onSelectFile,
}: SnapshotTreeColumnProps): React.ReactNode {
  const nodes = useMemo<FileTreeNode[]>(() => snapshotTreeNodes(entries ?? []), [entries]);
  const topDirs = useMemo(() => topLevelDirKeys(nodes), [nodes]);
  if (loading === true) return <Spin data-testid="browse-loading" />;
  if (error !== undefined) {
    return (
      <Typography.Text type="danger" data-testid="browse-error">
        {error}
      </Typography.Text>
    );
  }
  if (entries === undefined || entries.length === 0) return <EmptyState title="该版本没有文件" />;
  return (
    <FileTree
      key={revKey}
      nodes={nodes}
      selectedKeys={selectedPath !== undefined ? [selectedPath] : []}
      onSelect={onSelectFile}
      defaultExpandedKeys={topDirs}
    />
  );
}
