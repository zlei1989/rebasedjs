/**
 * 长文本截断：长 hash / 长路径 / 长分支名的统一呈现。
 * 做什么：Typography.Text + ellipsis，支持等宽与最大宽度，可选 hover 显示完整值。
 * 怎么做：用 antd 原生 ellipsis={{ tooltip }}（不自行包 Tooltip，少一层节点）；
 *        自身带 minWidth:0 —— flex 容器内截断生效的前提是父级链上都有 minWidth:0，
 *        父级由 PageShell / SplitPane 保证，本组件保证自身。
 */
import { Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

export interface EllipsisTextProps {
  children: string;
  /** 完整值；存在时 hover 显示（antd 原生 ellipsis tooltip） */
  title?: string;
  /** 等宽呈现（hash 用） */
  mono?: boolean;
  /** 最大宽度；不传则由父级约束 */
  maxWidth?: number | string;
}

export function EllipsisText({ children, title, mono, maxWidth }: EllipsisTextProps): ReactNode {
  const style: CSSProperties = { minWidth: 0 };
  if (maxWidth !== undefined) {
    style.maxWidth = maxWidth;
  }
  return (
    <Typography.Text code={mono} ellipsis={title !== undefined ? { tooltip: title } : true} style={style}>
      {children}
    </Typography.Text>
  );
}
