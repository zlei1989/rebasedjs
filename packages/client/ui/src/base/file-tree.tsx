/**
 * 文件树基础组件：antd Tree 的受控选择包装（纯展示，不调接口）。
 * 目录行点击 = 展开/收起（切换语义）；叶子行点击 = onSelect(key)。
 * 初始展开键仅首挂载生效——调用方以 key（如 rev）强制重挂载刷新初始态。
 * 复用场景：BrowsePanel（历史快照浏览）与 CommittedChangesPanel 目录树（后续任务）。
 */
import { Tree } from 'antd';
import { useState } from 'react';
import { EmptyState } from './empty-state';

/** 树节点：title 为展示名（basename），key 为完整路径（目录与文件同一命名空间） */
export interface FileTreeNode {
  key: string;
  title: React.ReactNode;
  isLeaf?: boolean;
  selectable?: boolean;
  children?: FileTreeNode[];
}

export interface FileTreeProps {
  nodes: FileTreeNode[];
  /** 选中叶子键（受控）；目录不进入选中态（点击目录即展开/收起） */
  selectedKeys?: string[];
  onSelect?: (key: string) => void;
  /** 空树占位文案 */
  emptyText?: string;
  /** 初始展开键（仅首挂载生效） */
  defaultExpandedKeys?: string[];
}

export function FileTree({
  nodes,
  selectedKeys = [],
  onSelect,
  emptyText = '暂无文件',
  defaultExpandedKeys = [],
}: FileTreeProps): React.ReactNode {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(defaultExpandedKeys);
  if (nodes.length === 0) return <EmptyState title={emptyText} />;
  return (
    <Tree
      blockNode
      treeData={nodes}
      selectedKeys={selectedKeys}
      expandedKeys={expandedKeys}
      onExpand={(keys) => setExpandedKeys(keys)}
      onSelect={(_keys, info) => {
        // 目录行：切换展开（不做选中——目录语义是导航容器）；叶子行：上抛 onSelect
        if (info.node.isLeaf) onSelect?.(String(info.node.key));
        else
          setExpandedKeys((prev) =>
            prev.includes(info.node.key) ? prev.filter((k) => k !== info.node.key) : [...prev, info.node.key],
          );
      }}
    />
  );
}
