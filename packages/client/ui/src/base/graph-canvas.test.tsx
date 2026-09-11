import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LayoutRow } from '../graph-layout/types';
import { GraphCanvas, laneCenterX, rowCenterY } from './graph-canvas';
import { buildRowSegments } from '../domain/commit-graph-segments';

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

describe('GraphCanvas', () => {
  it('按行数画节点圆点，并把编译好的线段画成 line/polyline', () => {
    const segmentsPerRow = buildRowSegments(rows, rows.map(() => []), ROW, LANE);
    const { container } = render(
      <GraphCanvas segmentsPerRow={segmentsPerRow} rows={rows} rowHeight={ROW} laneWidth={LANE} />,
    );
    // 节点圆点数等于行数
    expect(container.querySelectorAll('circle')).toHaveLength(rows.length);
    // 有边就应该有线（折线或直线）
    expect(container.querySelectorAll('line').length + container.querySelectorAll('polyline').length).toBeGreaterThan(0);
  });

  it('节点画在全局坐标的 lane/行中心上（x=(lane+0.5)*laneWidth，y=row*rowHeight+rowHeight/2）', () => {
    const segmentsPerRow = buildRowSegments(rows, rows.map(() => []), ROW, LANE);
    const { container } = render(
      <GraphCanvas segmentsPerRow={segmentsPerRow} rows={rows} rowHeight={ROW} laneWidth={LANE} />,
    );
    const circles = [...container.querySelectorAll('circle')];
    rows.forEach((row, i) => {
      expect(circles[i]!.getAttribute('cx')).toBe(String(laneCenterX(row.lane, LANE)));
      expect(circles[i]!.getAttribute('cy')).toBe(String(rowCenterY(i, ROW)));
    });
  });
});
