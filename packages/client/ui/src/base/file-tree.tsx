/**
 * 文件树基础组件：antd Tree 的受控选择包装（纯展示，不调接口）。
 * 目录行点击 = 展开/收起（切换语义）；叶子行点击 = onSelect(key)。
 * 初始展开键仅首挂载生效——调用方以 key（如 rev）强制重挂载刷新初始态。
 * 复用场景：SnapshotTreeColumn（日志页就地快照栏的「文件（N）」标签页）与 CommittedChangesPanel 目录树。
 * 不带 Tooltip：交互语义自解释（目录有展开箭头、叶子悬停高亮），常驻说明反而挡视线。
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
  /* 不再包 Tooltip（用户口径：删掉「浏览文件树：点击文件名选中该项…」那条提示）。
     交互语义改为**自解释**：目录行有展开箭头、叶子行悬停高亮 —— 树本来就该这样用，
     一条常驻说明反而在每次划过文件时弹出来挡视线。 */
  return (
    <Tree
      blockNode
      /* 视觉契约（file-tree.test 断言）：连接线开启 + 叶子行以短线占位而非文件图标
         （showLeafIcon 只能作为 showLine 对象配置传入；showIcon=false 本是默认值，显式
         写出是文档化意图——叶子徽标由 snapshotTreeNodes 按条目形态另行注入，与此无关）。 */
      showLine={{ showLeafIcon: false }}
      showIcon={false}
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
