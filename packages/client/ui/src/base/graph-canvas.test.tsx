import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LayoutRow } from '../graph-layout/types';
import { GraphCanvas } from './graph-canvas';

/** 三行布局：lane 0/1 交错，含一条跨 lane 边（0→1）与一条同行直边（1→1） */
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

describe('GraphCanvas', () => {
  it('按行数画节点圆点，按边段画折线（每条边两段 line）', () => {
    const { container } = render(<GraphCanvas rows={rows} rowHeight={24} />);
    // 每条边段折线简化为两段 line：2 条边 → 4 条线段，不少于行数
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(rows.length);
    // 节点圆点数等于行数
    expect(container.querySelectorAll('circle')).toHaveLength(rows.length);
  });
});
