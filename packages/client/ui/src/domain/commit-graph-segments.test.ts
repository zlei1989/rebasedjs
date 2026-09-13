// @vitest-environment node
/**
 * 提交图线段编译的不变量（纯函数）：
 *   ① **拐弯只占一行带、且紧贴起点行**：斜段起于起点行下方半行（= 行边界），止于再下一行边界；
 *      旧实现把斜段铺在「两行中点 → 终点」之间 —— 行距为偶数时拐点正好落在中间那一行的圆点上，
 *      图面凭空多出一条「那一行的提交 → 第二父」的假父子线；斜段铺长后还会贴着主竖线擦过中间各行的圆点。
 *   ② 每条切片都落在它所属行的带内，且跨行边在行边界处**首尾共点**（拼接无缝、线不断）。
 *   ③ 线条不得擦过任何一行自己的圆点（除该行自己的边之外）——这是①的兜底度量。
 *   ④ 每行的 `maxX` 覆盖本行带内所有线段的 x（调用方据此定宽，否则线被视口裁断，实测断 8px / 66px）。
 */
import { describe, expect, it } from 'vitest';
import { buildLayout, type LayoutCommit } from '../graph-layout';
import type { LayoutRow } from '../graph-layout/types';
import { laneCenterX, rowCenterY } from '../base/graph-canvas';
import { buildRowGeometry, laneCoveringX, type RowGeometry } from './commit-graph-segments';

const ROW = 24;
const LANE = 18;
const PAD = 10;
const DOT_R = ROW / 6;

/** 行中线：圆点中心的 y */
const isRowCenterLine = (y: number): boolean => (y - ROW / 2) % ROW === 0;

/** 点到线段的距离（判定「线条是否擦过圆点」） */
function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 切片 key 解析：`e{起点行}-{终点行}-{边序}-{部件}{起点 y}` */
function parseKey(key: string): { fromRow: number; toRow: number; part: string } {
  const [from, to, , part] = key.split('-');
  return { fromRow: Number(from!.slice(1)), toRow: Number(to), part: part! };
}

/** 所有边「竖段 → 斜段」的交界点（拐点）：斜段切片的起点 */
function bends(geometry: RowGeometry[]): Array<{ key: string; x: number; y: number }> {
  const out: Array<{ key: string; x: number; y: number }> = [];
  for (const row of geometry) {
    for (const segment of row.segments) {
      if (parseKey(segment.key).part.startsWith('b')) {
        out.push({ key: segment.key, x: segment.pts[0]!, y: segment.pts[1]! });
      }
    }
  }
  return out;
}

/**
 * 隔 2 行的第二父（旧实现的拐点落在第 1 行的圆点上）：
 * row0 m 合并 a 与 c，c 在 row2（lane 1）——(0+2) 为偶数，两行中点 = row1 的中线。
 */
const gapTwo: LayoutCommit[] = [
  { hash: 'm', parents: ['a', 'c'], refs: [] },
  { hash: 'a', parents: ['b'], refs: [] },
  { hash: 'c', parents: ['b'], refs: [] },
  { hash: 'b', parents: [], refs: [] },
];

/** 隔 6 行的第二父（旧实现的拐点落在中间某行的圆点上）+ 跨 lane 长边 */
const gapFar: LayoutCommit[] = [
  { hash: 'm', parents: ['a', 'g'], refs: [] },
  { hash: 'a', parents: ['b'], refs: [] },
  { hash: 'b', parents: ['c'], refs: [] },
  { hash: 'c', parents: ['d'], refs: [] },
  { hash: 'd', parents: ['e'], refs: [] },
  { hash: 'e', parents: ['f'], refs: [] },
  { hash: 'g', parents: ['f'], refs: [] },
  { hash: 'f', parents: [], refs: [] },
];

describe('buildRowGeometry', () => {
  it('隔 2 行的第二父：拐弯紧贴合并行、不落在中间那一行的中线上（旧实现挂在该行圆点上）', () => {
    const rows = buildLayout(gapTwo);
    const geometry = buildRowGeometry(rows, ROW, LANE);
    const points = bends(geometry);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(isRowCenterLine(p.y)).toBe(false);
    // 第二父那条边（row0 → row2）的拐弯：起于 row0 下方半行（行边界），即「分叉挂在合并提交那一行」
    const mergeBend = points.find((p) => parseKey(p.key).toRow === 2);
    expect(mergeBend).toBeDefined();
    expect(mergeBend!.y).toBe(rowCenterY(0, ROW) + ROW / 2);
    expect(mergeBend!.x).toBe(laneCenterX(0, LANE));
  });

  it('拐弯最多占一行带：斜段止于再下一行边界', () => {
    const rows = buildLayout(gapFar);
    const geometry = buildRowGeometry(rows, ROW, LANE);
    for (const row of geometry) {
      for (const segment of row.segments) {
        if (!parseKey(segment.key).part.startsWith('b')) continue;
        expect(segment.pts[3]! - segment.pts[1]!).toBeLessThanOrEqual(ROW + 1e-9);
      }
    }
  });

  it('长边在中间各行占住目标 lane 的竖线（分叉不会「从中间某一行长出来」）', () => {
    const rows = buildLayout(gapFar);
    const geometry = buildRowGeometry(rows, ROW, LANE);
    // m(row0, lane0) → g(row6, lane1)：拐弯在 row1 带内完成，row2..row6 应各有 lane 1 上的竖线
    const targetX = laneCenterX(1, LANE);
    for (const index of [2, 3, 4, 5, 6]) {
      const vertical = geometry[index]!.segments.filter(
        (s) => s.pts[0] === targetX && s.pts[2] === targetX,
      );
      expect(vertical.length, `row ${index} 应含目标 lane 的竖线`).toBeGreaterThan(0);
    }
  });

  it('线条不擦过其他行的圆点（除本行自己的边之外）', () => {
    for (const commits of [gapTwo, gapFar]) {
      const rows = buildLayout(commits);
      const geometry = buildRowGeometry(rows, ROW, LANE);
      rows.forEach((row, index) => {
        const cx = laneCenterX(row.lane, LANE);
        const cy = rowCenterY(index, ROW);
        for (const segment of geometry[index]!.segments) {
          const { fromRow, toRow } = parseKey(segment.key);
          if (fromRow === index || toRow === index) continue; // 本行自己的边：端点就在圆点上
          const d = distanceToSegment(cx, cy, segment.pts[0]!, segment.pts[1]!, segment.pts[2]!, segment.pts[3]!);
          expect(d, `row ${index} 的圆点被 ${segment.key} 擦过`).toBeGreaterThan(DOT_R);
        }
      });
    }
  });

  it('切片落在本行带内，且相邻两行在行边界处首尾共点（线不断、无缝）', () => {
    const rows = buildLayout(gapFar);
    const geometry = buildRowGeometry(rows, ROW, LANE);
    geometry.forEach((row, index) => {
      for (const segment of row.segments) {
        expect(segment.pts[1]).toBeGreaterThanOrEqual(index * ROW - 1e-9);
        expect(segment.pts[3]).toBeLessThanOrEqual((index + 1) * ROW + 1e-9);
      }
    });
    // 同一位置的上下两片必须严丝合缝：上一行的终点 == 下一行的起点
    const starts = new Map<string, Array<[number, number]>>();
    const ends = new Map<string, Array<[number, number]>>();
    geometry.forEach((row, index) => {
      for (const segment of row.segments) {
        const edgeKey = segment.key.slice(0, segment.key.lastIndexOf('-'));
        const start: [number, number] = [segment.pts[0]!, segment.pts[1]!];
        const end: [number, number] = [segment.pts[2]!, segment.pts[3]!];
        starts.set(edgeKey, [...(starts.get(edgeKey) ?? []), start]);
        ends.set(edgeKey, [...(ends.get(edgeKey) ?? []), end]);
      }
    });
    for (const [edgeKey, list] of ends) {
      // 每条边的竖段/斜段/竖段三类切片之间：至少存在一处「终点 == 另一片的起点」
      const nextStarts = starts.get(edgeKey) ?? [];
      const joined = list.filter((end) => nextStarts.some((s) => s[0] === end[0] && s[1] === end[1]));
      expect(joined.length, `${edgeKey} 的切片在行边界处应共点`).toBeGreaterThan(0);
    }
  });

  it('maxX 覆盖本行全部线段，且按它算出的宽度让文字让开线条、线也不被裁断', () => {
    const rows = buildLayout(gapFar);
    const geometry = buildRowGeometry(rows, ROW, LANE);
    geometry.forEach((row, index) => {
      const lane = Math.max(rows[index]!.lane, laneCoveringX(row.maxX, LANE));
      // 图列宽度 = (lane+1)×LANE + 2×PAD；viewBox 从 -PAD 起 → 可见 x 上界如下
      const visibleRight = (lane + 1) * LANE + PAD;
      // 文字起点（全局）= 车道中心 + DOT_GUTTER(8)：必须落在最深的那条线右侧
      const textStartX = laneCenterX(lane, LANE) + 8;
      for (const segment of row.segments) {
        const maxSegmentX = Math.max(segment.pts[0]!, segment.pts[2]!);
        expect(maxSegmentX).toBeLessThanOrEqual(visibleRight);
        expect(maxSegmentX).toBeLessThanOrEqual(textStartX);
      }
      // 圆点（中心 + 半径）也要完整落在视口内
      expect(laneCenterX(rows[index]!.lane, LANE) + DOT_R).toBeLessThanOrEqual(visibleRight);
      // maxX 本身取的是本行带内所有 x 的上界
      for (const segment of row.segments) expect(row.maxX).toBeGreaterThanOrEqual(Math.max(segment.pts[0]!, segment.pts[2]!));
    });
  });

  it('同 lane 的直边不拐弯，也不产生额外宽度（缩进与旧口径一致）', () => {
    const rows = buildLayout([{ hash: 'a', parents: ['b'], refs: [] }, { hash: 'b', parents: [], refs: [] }]);
    const geometry = buildRowGeometry(rows, ROW, LANE);
    expect(geometry[1]!.segments.length).toBeGreaterThan(0);
    for (const segment of geometry[1]!.segments) expect(segment.pts[0]).toBe(laneCenterX(0, LANE));
    expect(bends(geometry)).toEqual([]);
    expect(geometry[1]!.maxX).toBe(laneCenterX(0, LANE));
    expect(geometry[0]!.maxX).toBe(laneCenterX(0, LANE));
  });

  it('切片的 edge 字段保留端点与来源（供图元命中）', () => {
    const rows: LayoutRow[] = [
      { commit: { hash: 'a', parents: ['b'], refs: [] }, lane: 0, edges: [{ fromLane: 0, toLane: 0, fromRow: 0, toRow: 1, type: 'D', kind: 'collapse' }], color: '#000000' },
      { commit: { hash: 'b', parents: [], refs: [] }, lane: 0, edges: [], color: '#000000' },
    ];
    const geo = buildRowGeometry(rows, 24, 18);
    const seg = geo[0].segments[0];
    expect(seg.edge).toEqual({ up: 0, down: 1, kind: 'collapse' });
    expect(seg.dashed).toBe(true);
  });
});
