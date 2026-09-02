/**
 * 提交图画布：把 graph-layout 产出的 LayoutRow/EdgeSegment 画成 SVG。
 * 做法：每行在 (lane+0.5)*laneWidth 处画一个节点圆点；每条边段画成两段
 * <line> 组成的折线（先竖直走半程，再斜向目标 lane），虚线边用 strokeDasharray。
 */
import type { ReactNode } from 'react';
import type { LayoutRow } from '../graph-layout/types';

export interface GraphCanvasProps {
  rows: LayoutRow[];
  rowHeight: number;
  laneWidth?: number;
  /**
   * 切片行偏移：EdgeSegment 的 fromRow/toRow 是 buildLayout 的全量行号，
   * 渲染行切片（如 CommitGraph 的 3 行窗口）时须减去该偏移换算为切片局部坐标；
   * 节点圆点本就用切片局部下标，不受影响。默认 0（传全量行时）。
   */
  rowOffset?: number;
}

/** lane/行号 → 节点中心坐标 */
function center(lane: number, row: number, rowHeight: number, laneWidth: number): { x: number; y: number } {
  return { x: (lane + 0.5) * laneWidth, y: row * rowHeight + rowHeight / 2 };
}

export function GraphCanvas({ rows, rowHeight, laneWidth = 16, rowOffset = 0 }: GraphCanvasProps): ReactNode {
  const maxLane = rows.reduce((m, r) => Math.max(m, r.lane, ...r.edges.map((e) => Math.max(e.fromLane, e.toLane))), 0);
  const width = (maxLane + 1) * laneWidth;
  const height = rows.length * rowHeight;
  return (
    <svg width={width} height={height} data-testid="graph-canvas">
      {rows.flatMap((row) =>
        row.edges.map((edge, ei) => {
          const from = center(edge.fromLane, edge.fromRow - rowOffset, rowHeight, laneWidth);
          const to = center(edge.toLane, edge.toRow - rowOffset, rowHeight, laneWidth);
          const midY = (from.y + to.y) / 2;
          const dash = edge.type === 'D' ? '4 3' : undefined;
          return [
            <line
              key={`${row.commit.hash}-${ei}-v`}
              x1={from.x}
              y1={from.y}
              x2={from.x}
              y2={midY}
              stroke={row.color}
              strokeDasharray={dash}
            />,
            <line
              key={`${row.commit.hash}-${ei}-d`}
              x1={from.x}
              y1={midY}
              x2={to.x}
              y2={to.y}
              stroke={row.color}
              strokeDasharray={dash}
            />,
          ];
        }),
      )}
      {rows.map((row, i) => {
        const c = center(row.lane, i, rowHeight, laneWidth);
        return <circle key={row.commit.hash} cx={c.x} cy={c.y} r={rowHeight / 6} fill={row.color} />;
      })}
    </svg>
  );
}
