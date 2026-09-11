/**
 * 提交图画布（纯渲染）：把调用方编译好的折线段与节点圆点画成 SVG。
 *
 * 全部按**整图全局坐标**绘制（x = laneCenterX，y = rowCenterY）——调用方给每行一个
 * 只覆盖该行可见带的 `viewBox`，于是同一根线在相邻两行画出的两半在边界处以同一坐标相接，
 * 不会出现早期「每行一块局部画布再裁切拼接」造成的接缝与色差。
 * 段的编译（哪一段归哪一行）在 `domain/commit-graph-segments.ts`，便于单测。
 */
import type { ReactNode } from 'react';
import type { LayoutRow } from '../graph-layout/types';

/** 一行里要画的线段（全局坐标）：`pts` 为折线顶点，按 [x,y,x,y,...] 成对给出 */
export interface RowGraphSegment {
  key: string;
  color: string;
  pts: number[];
  dashed?: boolean;
}

export interface GraphCanvasProps {
  /** 逐行要画的线段（下标 = 行号） */
  segmentsPerRow: RowGraphSegment[][];
  rows: LayoutRow[];
  rowHeight: number;
  laneWidth: number;
}

/** lane → 节点中心 x（全局坐标系） */
export function laneCenterX(lane: number, laneWidth: number): number {
  return (lane + 0.5) * laneWidth;
}

/** 行号 → 节点中心 y（全局坐标系） */
export function rowCenterY(rowIndex: number, rowHeight: number): number {
  return rowIndex * rowHeight + rowHeight / 2;
}

export function GraphCanvas({ segmentsPerRow, rows, rowHeight, laneWidth }: GraphCanvasProps): ReactNode {
  return (
    <>
      {segmentsPerRow.flatMap((segments) =>
        segments.map((segment) =>
          segment.pts.length === 2 ? (
            <line
              key={segment.key}
              x1={segment.pts[0]}
              y1={segment.pts[1]}
              x2={segment.pts[2]}
              y2={segment.pts[3]}
              stroke={segment.color}
              strokeDasharray={segment.dashed ? '4 3' : undefined}
            />
          ) : (
            <polyline
              key={segment.key}
              points={Array.from({ length: segment.pts.length / 2 }, (_, i) => `${segment.pts[i * 2]},${segment.pts[i * 2 + 1]}`).join(' ')}
              fill="none"
              stroke={segment.color}
              strokeDasharray={segment.dashed ? '4 3' : undefined}
            />
          ),
        ),
      )}
      {rows.map((row, i) => (
        <circle
          key={row.commit.hash}
          cx={laneCenterX(row.lane, laneWidth)}
          cy={rowCenterY(i, rowHeight)}
          r={rowHeight / 6}
          fill={row.color}
        />
      ))}
    </>
  );
}
