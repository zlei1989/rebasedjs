import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
