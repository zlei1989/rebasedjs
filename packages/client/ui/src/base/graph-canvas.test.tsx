import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LayoutRow } from '../graph-layout/types';
import { GraphCanvas, laneCenterX, rowCenterY, type GraphNode } from './graph-canvas';
import { buildRowGeometry } from '../domain/commit-graph-segments';

/** 三行布局：lane 0/1 交错，含一条跨 lane 边（0→1）与一条同 lane 直边（1→1） */
const rows: LayoutRow[] = [
  {
    commit: { hash: 'a', parents: ['b'], refs: [] },
    lane: 0,
    color: '#ff0000',
    edges: [{ fromLane: 0, toLane: 1, fromRow: 0, toRow: 1 }],
  },
  {
    commit: { hash: 'b', parents: ['c'], refs: [] },
    lane: 1,
    color: '#0000ff',
    edges: [{ fromLane: 1, toLane: 1, fromRow: 1, toRow: 2 }],
  },
  {
    commit: { hash: 'c', parents: [], refs: [] },
    lane: 1,
    color: '#0000ff',
    edges: [],
  },
];

const ROW = 24;
const LANE = 18;

/** 行号 → 节点（画布只认全局坐标，行号由调用方给） */
const nodeOf = (index: number): GraphNode => ({
  hash: rows[index]!.commit.hash,
  lane: rows[index]!.lane,
  rowIndex: index,
  color: rows[index]!.color,
});

describe('GraphCanvas', () => {
  it('只画传进来的线段与圆点（每行一块画布，不再整图重画）', () => {
    const geometry = buildRowGeometry(rows, ROW, LANE);
    const { container } = render(
      <GraphCanvas segments={geometry[0]!.segments} nodes={[nodeOf(0)]} rowHeight={ROW} laneWidth={LANE} />,
    );
    // 圆点只有本行那一个（旧实现每行都画全图的行数 × 圆点数）
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    // 有边就应该有线（折线或直线）
    expect(container.querySelectorAll('line').length + container.querySelectorAll('polyline').length).toBeGreaterThan(0);
  });

  it('圆点画在全局坐标的 lane/行中心上（x=(lane+0.5)*laneWidth，y=row*rowHeight+rowHeight/2）', () => {
    const geometry = buildRowGeometry(rows, ROW, LANE);
    const { container } = render(
      <GraphCanvas
        segments={geometry.flatMap((g) => g.segments)}
        nodes={rows.map((_, i) => nodeOf(i))}
        rowHeight={ROW}
        laneWidth={LANE}
      />,
    );
    const circles = [...container.querySelectorAll('circle')];
    rows.forEach((row, i) => {
      expect(circles[i]!.getAttribute('cx')).toBe(String(laneCenterX(row.lane, LANE)));
      expect(circles[i]!.getAttribute('cy')).toBe(String(rowCenterY(i, ROW)));
    });
  });

  // 图元命中（设计 §3.5）：线段叠一条透明命中带，圆点自身可点；命中带比线宽，解决 1px 线难点的问题
  it('线段渲染透明命中带并派发 onSegmentClick', () => {
    const onSegmentClick = vi.fn();
    render(
      // 外面套一层 <svg>：画布只画 SVG 元素（line/polyline/g/circle），直接挂在 HTML 根下会让
      // React 按 HTML 命名空间创建它们并报「unrecognized tag」警告，噪声盖住真实失败信息
      <svg>
        <GraphCanvas
          segments={[{ key: 's1', color: '#000', pts: [9, 12, 9, 36], dashed: true, edge: { up: 0, down: 2, kind: 'collapse' } }]}
          nodes={[]}
          rowHeight={24}
          laneWidth={18}
          onSegmentClick={onSegmentClick}
        />
      </svg>,
    );
    const hit = screen.getByTestId('graph-edge-hit-0-2');
    expect(hit).toHaveAttribute('stroke', 'transparent');
    fireEvent.click(hit);
    expect(onSegmentClick).toHaveBeenCalledWith({ up: 0, down: 2, kind: 'collapse' });
  });

  it('圆点派发 onNodeClick / onNodeHover，highlighted 时画高亮环', () => {
    const onNodeClick = vi.fn();
    const onNodeHover = vi.fn();
    render(
      <svg>
        <GraphCanvas
          segments={[]}
          nodes={[{ hash: 'h1', lane: 0, rowIndex: 0, color: '#123456', highlighted: true }]}
          rowHeight={24}
          laneWidth={18}
          highlightColor="#ff0000"
          onNodeClick={onNodeClick}
          onNodeHover={onNodeHover}
        />
      </svg>,
    );
    fireEvent.click(screen.getByTestId('graph-node-h1'));
    expect(onNodeClick).toHaveBeenCalledWith('h1');
    // 用 mouseOver 而非 mouseEnter 触发 React 的 onMouseEnter：React 的 enter/leave 是由
    // mouseover/mouseout 合成出来的，直接派发 mouseenter 在 jsdom 下不会走 React 的合成链路
    fireEvent.mouseOver(screen.getByTestId('graph-node-h1'));
    expect(onNodeHover).toHaveBeenCalledWith('h1');
    expect(screen.getByTestId('graph-node-ring-h1')).toHaveAttribute('stroke', '#ff0000');
  });
});
