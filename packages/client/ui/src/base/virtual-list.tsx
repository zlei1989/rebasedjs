/**
 * 固定行高虚拟列表：只渲染可视窗口（含 overscan），支撑万级提交图滚动。
 * 做法：外层容器监听 scroll 记录 scrollTop，内层撑开总高度维持滚动条，
 * 仅对 [start, end) 区间的行做绝对定位渲染。
 */
import { useMemo, useState, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  overscan?: number;
}

export function VirtualList<T>({ items, rowHeight, height, renderRow, overscan = 5 }: VirtualListProps<T>): ReactNode {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);
  return (
    <div style={{ height, overflowY: 'auto' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {visible.map((item, i) => (
          <div
            key={start + i}
            style={{ position: 'absolute', top: (start + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}
          >
            {renderRow(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
