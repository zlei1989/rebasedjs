/**
 * FileTree 测试：视觉契约——showLine 连接线开启（根带 ant-tree-show-line）、
 * 叶子行渲染短线占位（ant-tree-switcher-leaf-line）而非文件图标（.anticon-file）。
 * 类名断言走 antd 语义类：它们是 showLine/showLeafIcon 配置在 DOM 上的直接产物；
 * 线色/缩进等样式细节不进断言（主题 token 决定，属 antd 职责）。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileTree, type FileTreeNode } from './file-tree';

const NODES: FileTreeNode[] = [
  { key: 'lib', title: 'lib', children: [{ key: 'lib/a.ts', title: 'a.ts', isLeaf: true }] },
  { key: 'b.txt', title: 'b.txt', isLeaf: true },
];

describe('FileTree', () => {
  it('视觉契约：连接线开启、叶子为短线占位而非文件图标', () => {
    const { container } = render(<FileTree nodes={NODES} />);
    // 连接线：根节点带 show-line 语义类（rc-tree 依据 showLine 真值挂载）
    expect(container.querySelector('.ant-tree-show-line')).not.toBeNull();
    // 叶子行：短线占位（showLeafIcon=false 时 antd 以 span 渲染短线，不渲染文件图标）
    expect(container.querySelector('.ant-tree-switcher-leaf-line')).not.toBeNull();
    expect(container.querySelector('.ant-tree-switcher .anticon-file')).toBeNull();
  });
});
