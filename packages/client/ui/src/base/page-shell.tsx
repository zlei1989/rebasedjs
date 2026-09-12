/**
 * 页面根容器：全站「弹性布局 + 横向沾满」的唯一出口。
 * 做什么：纵向 Flex 根 + width:100% + minWidth:0 + height:100%，并施加紧凑密度。
 * 怎么做/为什么：
 *   1. 刻意不设 alignItems —— 纵向 Flex 交叉轴是水平方向，align-items:flex-start 会使子元素
 *      不横向拉伸（"没有横向沾满"）并把父级顶宽（意外横向滚动条）。全站原先 44 处
 *      `align="flex-start"` 里有 40 处正是这种纵向页面根，删掉它们才是修好；另 4 处在**横向**
 *      容器上（交叉轴为纵向）表示顶对齐，必须保留。
 *   2. minWidth:0 阻止 flex 子项把父级顶宽；scroll="inner" 另需 minHeight:0（纵向主轴默认
 *      min-height:auto 会让内容撑开容器而不产生内部滚动）。
 *   3. padding/gap 默认不落 style —— 既有 16px 内边距由页面级 composite 自带，
 *      原语默认值一旦非 0，迁移会凭空新增间距并可能制造溢出（设计文档 §5）。
 * 注意：density="compact"（默认）在内部包一层 ConfigProvider，其 algorithm 自带完整底色算法，
 *      因此不依赖 antd 嵌套 ConfigProvider 的 algorithm 合并语义；设置页传 "default" 豁免。
 */
import { ConfigProvider, Flex } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { compactTheme } from './density';
import { useDensityMode } from './density-context';

/** 紧凑主题按明暗预生成一次：避免每次 render 重建 ThemeConfig（algorithm 数组引用亦保持稳定） */
const COMPACT_THEMES = {
  light: compactTheme('light'),
  dark: compactTheme('dark'),
} as const;

export interface PageShellProps {
  children: ReactNode;
  /** 密度：compact（默认，全站通用）| default（仅设置页豁免） */
  density?: 'compact' | 'default';
  /** 内边距；不传则不落 style（保持既有行为） */
  padding?: number | string;
  /** 纵向间距；不传则不落 style（保持既有行为） */
  gap?: number;
  /** page：由外层文档滚动（默认）| inner：根自身滚动（长列表页）| none：不接管 */
  scroll?: 'page' | 'inner' | 'none';
}

export function PageShell({
  children,
  density = 'compact',
  padding,
  gap,
  scroll = 'page',
}: PageShellProps): ReactNode {
  const mode = useDensityMode();
  // 只编码结构性不变量；间距仅在显式传入时落 style（见文件头第 3 点）
  const style: CSSProperties = {
    width: '100%',
    minWidth: 0,
    height: '100%',
  };
  if (padding !== undefined) {
    style.padding = padding;
  }
  if (gap !== undefined) {
    style.gap = gap;
  }
  if (scroll === 'inner') {
    style.overflow = 'auto';
    style.minHeight = 0;
  }
  const content = (
    <Flex vertical style={style}>
      {children}
    </Flex>
  );
  // 豁免页不包 ConfigProvider，直接落回外层主题（antd 默认或 app 的明暗主题）
  if (density === 'default') {
    return content;
  }
  return <ConfigProvider theme={COMPACT_THEMES[mode]}>{content}</ConfigProvider>;
}
