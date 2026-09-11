/**
 * 工具/过滤行：横向一行的按钮与输入控件集合，过宽时自动换行。
 * 做什么：统一 flexWrap + 对齐 + 间距，取代各页手写的 flexWrap 补丁
 *        （docs/e2e-verification.md D-12 那类"标签文字被压成竖排"的成因）。
 * 怎么做：只对容器负责 —— 容器 flexWrap='wrap' 让过宽子项换到下一行；
 *        **不克隆 children**，需要收缩（flex:1; minWidth:0）的子项由调用点自己声明。
 */
import { Flex } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

/** 对齐口径 → antd Flex justify 值 */
const JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const;

export interface ToolbarProps {
  children: ReactNode;
  /** 主轴对齐，默认 start */
  align?: keyof typeof JUSTIFY;
  /** 间距；不传则不落 style */
  gap?: number;
  /** 是否允许换行，默认 true */
  wrap?: boolean;
}

export function Toolbar({ children, align = 'start', gap, wrap = true }: ToolbarProps): ReactNode {
  const style: CSSProperties = {
    width: '100%',
    minWidth: 0,
  };
  if (gap !== undefined) {
    style.gap = gap;
  }
  return (
    <Flex align="center" justify={JUSTIFY[align]} wrap={wrap ? 'wrap' : 'nowrap'} style={style}>
      {children}
    </Flex>
  );
}
