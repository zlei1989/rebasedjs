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
 *
 * 图元命中（做什么）：圆点与线段都把自己携带的语义（提交 hash / 边的端点与来源）经回调交回调用方，
 * 本层不判断「点了会发生什么」（折叠、展开、选中与否都是 domain 的决策）。
 * （怎么做）可视线只有 1px，浏览器里几乎点不中，故每条带 `edge` 的切片再叠一条 `strokeWidth=6`
 * 的透明 polyline 作命中带；圆点与命中带都挂 React 鼠标事件（enter/leave 由 React 从
 * mouseover/mouseout 合成，测试要用 `fireEvent.mouseOver` 而非 `mouseenter`）。
 */
import type { ReactNode } from 'react';

/** 一行里要画的线段（全局坐标）：`pts` 为折线顶点，按 [x,y,x,y,...] 成对给出 */
export interface RowGraphSegment {
  key: string;
  color: string;
  pts: number[];
  dashed?: boolean;
  /** 该切片所属边的端点（**可见行号**）与来源；缺省 = 不可命中（渲染层自造的装饰段） */
  edge?: { up: number; down: number; kind?: 'collapse' | 'filter' };
}

/** 一个节点圆点（全局坐标由 lane/行号算出） */
export interface GraphNode {
  /** React key（用提交 hash） */
  hash: string;
  lane: number;
  /** 行号（0 基） */
  rowIndex: number;
  color: string;
  /** 悬停高亮（线性链高亮）：画一圈高亮环 */
  highlighted?: boolean;
}

export interface GraphCanvasProps {
  /** 本行要画的线段（已按行切好，全局坐标） */
  segments: RowGraphSegment[];
  /** 本行要画的圆点（通常 1 个：本行自己的节点；留成数组便于单测直接喂多节点） */
  nodes: GraphNode[];
  rowHeight: number;
  laneWidth: number;
  /** 高亮环颜色（调用方传主题 token；缺省不画环） */
  highlightColor?: string;
  /** 圆点点击（提交 hash）；缺省不绑事件 */
  onNodeClick?: (hash: string) => void;
  /** 圆点悬停（进入传 hash、离开传 null）；缺省不绑事件 */
  onNodeHover?: (hash: string | null) => void;
  /** 线段命中带点击 */
  onSegmentClick?: (edge: NonNullable<RowGraphSegment['edge']>) => void;
  /** 线段命中带悬停（进入传 edge、离开传 null） */
  onSegmentHover?: (edge: NonNullable<RowGraphSegment['edge']> | null) => void;
}

/** lane → 节点中心 x（全局坐标系） */
export function laneCenterX(lane: number, laneWidth: number): number {
  return (lane + 0.5) * laneWidth;
}

/** 行号 → 节点中心 y（全局坐标系） */
export function rowCenterY(rowIndex: number, rowHeight: number): number {
  return rowIndex * rowHeight + rowHeight / 2;
}

export function GraphCanvas({
  segments,
  nodes,
  rowHeight,
  laneWidth,
  highlightColor,
  onNodeClick,
  onNodeHover,
  onSegmentClick,
  onSegmentHover,
}: GraphCanvasProps): ReactNode {
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
      {/* 命中带：叠在可视线之上的一条透明粗线。为什么需要——1px 的线在浏览器里极难点中，
          Java 侧靠 GraphCellPainter.getElementUnderCursor 的容差距离判定达到同样效果。
          只在线段带 edge 时渲染（没有边语义的装饰段不该吃掉点击）。 */}
      {segments.map((segment) =>
        segment.edge === undefined ? null : (
          <polyline
            key={`hit-${segment.key}`}
            data-testid={`graph-edge-hit-${segment.edge.up}-${segment.edge.down}`}
            points={Array.from({ length: segment.pts.length / 2 }, (_, i) => `${segment.pts[i * 2]},${segment.pts[i * 2 + 1]}`).join(' ')}
            fill="none"
            stroke="transparent"
            strokeWidth={6}
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onClick={() => onSegmentClick?.(segment.edge!)}
            onMouseEnter={() => onSegmentHover?.(segment.edge!)}
            onMouseLeave={() => onSegmentHover?.(null)}
          />
        ),
      )}
      {nodes.map((node) => {
        const cx = laneCenterX(node.lane, laneWidth);
        const cy = rowCenterY(node.rowIndex, rowHeight);
        return (
          <g key={node.hash}>
            {node.highlighted === true && highlightColor !== undefined ? (
              <circle
                data-testid={`graph-node-ring-${node.hash}`}
                cx={cx}
                cy={cy}
                r={rowHeight / 4}
                fill="none"
                stroke={highlightColor}
                strokeWidth={2}
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
            <circle
              data-testid={`graph-node-${node.hash}`}
              cx={cx}
              cy={cy}
              r={rowHeight / 6}
              fill={node.color}
              style={{ cursor: onNodeClick === undefined ? undefined : 'pointer' }}
              onClick={() => onNodeClick?.(node.hash)}
              onMouseEnter={() => onNodeHover?.(node.hash)}
              onMouseLeave={() => onNodeHover?.(null)}
            />
          </g>
        );
      })}
    </>
  );
}
