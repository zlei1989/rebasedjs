/**
 * 文件树基础组件：antd Tree 的受控选择包装（纯展示，不调接口）。
 * 目录行点击 = 展开/收起（切换语义）；叶子行点击 = onSelect(key)。
 * 初始展开键仅首挂载生效——调用方以 key（如 rev）强制重挂载刷新初始态。
 * 复用场景：BrowsePanel（历史快照浏览）与 CommittedChangesPanel 目录树（后续任务）。
 */
import { Tooltip, Tree } from 'antd';
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

/**
 * 文件树交互提示文案：基础组件与调用方共用。
 * 调用方（如 BrowsePanel）会在 FileTree 外再包一层 Tooltip（门禁按文件逐个审计，各自都要有一对一覆盖），
 * 而两层 Tooltip 落在同一块悬停区域上会同时弹出，文案必须一致——否则两个气泡互相遮挡、观感是两个提示。
 */
export const FILE_TREE_TOOLTIP = '浏览文件树：点击文件名选中该项，点击目录名展开或收起（目录不进入选中态）';

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
  // 树节点行由 antd 依据 treeData 生成（无法逐行包 Tooltip，见 docs/tooltip-coverage.md §四），
  // 故整体包一层 Tooltip 说明树的交互语义；文案走导出常量，调用方复用同一份避免两层气泡文案打架。
  // 中间必须包一层真实 DOM（span）作为悬停宿主：antd Tree 只透传 aria/data 属性到根节点，
  // 直接包 Tree 时 Tooltip 拿不到 ref / 事件，气泡永不弹出（实测 0 次触发）。
  // span 用 display:block 保持与原根 div 相同的块级占位，不改变尺寸。
  return (
    <Tooltip title={FILE_TREE_TOOLTIP}>
      <span style={{ display: 'block' }}>
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
      </span>
    </Tooltip>
  );
}
