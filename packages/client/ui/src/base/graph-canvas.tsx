/**
 * 提交图画布（纯渲染）：把调用方编译好的折线段与节点圆点画成 SVG。
 *
 * 全部按**整图全局坐标**绘制（x = laneCenterX，y = rowCenterY）——调用方给每行一个
 * 只覆盖该行可见带的 `viewBox`，于是同一根线在相邻两行画出的两半在边界处以同一坐标相接，
 * 不会出现早期「每行一块局部画布再裁切拼接」造成的接缝与色差。
 * 段的编译（哪一段归哪一行）在 `domain/commit-graph-segments.ts`，便于单测。
 *
 * 只画传进来的东西（每行只拿本行的切片与本行的圆点）：早期实现每行都渲染整张图再靠 viewBox 裁掉，
 * 大仓（1000 提交 × 40 可见行）会往 DOM 里塞 8 万个 SVG 节点，是纯粹的白烧。
 */
import type { ReactNode } from 'react';

/** 一行里要画的线段（全局坐标）：`pts` 为折线顶点，按 [x,y,x,y,...] 成对给出 */
export interface RowGraphSegment {
  key: string;
  color: string;
  pts: number[];
  dashed?: boolean;
}

/** 一个节点圆点（全局坐标由 lane/行号算出） */
export interface GraphNode {
  /** React key（用提交 hash） */
  hash: string;
  lane: number;
  /** 行号（0 基） */
  rowIndex: number;
  color: string;
}

export interface GraphCanvasProps {
  /** 本行要画的线段（已按行切好，全局坐标） */
  segments: RowGraphSegment[];
  /** 本行要画的圆点（通常 1 个：本行自己的节点；留成数组便于单测直接喂多节点） */
  nodes: GraphNode[];
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

export function GraphCanvas({ segments, nodes, rowHeight, laneWidth }: GraphCanvasProps): ReactNode {
  return (
    <>
      {segments.map((segment) =>
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
      )}
      {nodes.map((node) => (
        <circle
          key={node.hash}
          cx={laneCenterX(node.lane, laneWidth)}
          cy={rowCenterY(node.rowIndex, rowHeight)}
          r={rowHeight / 6}
          fill={node.color}
        />
      ))}
    </>
  );
}
