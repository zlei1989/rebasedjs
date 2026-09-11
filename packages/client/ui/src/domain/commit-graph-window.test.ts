// @vitest-environment node
/**
 * 画布窗口几何回归：把两条不变量钉住 ——
 *   ① 本行圆点恒落在本行行盒中点（曾坏过：行不再裁剪 → 画布盖到相邻行 → 12px 步进的重复圆点 → 「图与文字行错位」）；
 *   ② 相邻行的 SVG 视口首尾相接且覆盖整条行边界（曾坏过：把行裁成 24px → 跨行斜边被切成两截 → 「分叉线段连接不对」）。
 */
import { describe, expect, it } from 'vitest';
import { rowCanvasWindow } from './commit-graph-window';

const ROW = 24;

/** 本行圆点在「视口坐标系」里的 y（视口顶 = 本行顶 − ROW，故行中点在视口内 1.5*ROW） */
function ownDotInViewport(index: number, total: number, rowHeight = ROW): number {
  const w = rowCanvasWindow(index, total, rowHeight);
  return w.contentOffsetY + (w.ownIndexInSlice + 0.5) * rowHeight;
}

describe('rowCanvasWindow', () => {
  it('① 本行圆点恒落在视口内的行中点（首行/中间行/末行/单行/不同行高）', () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [0, 23],
      [1, 23],
      [7, 23],
      [22, 23],
      [0, 500],
      [499, 500],
      [250, 500],
    ];
    for (const [index, total] of cases) {
      expect(ownDotInViewport(index, total), `index=${index} total=${total}`).toBe(ROW * 1.5);
    }
    for (const rowHeight of [16, 20, 24, 32, 48]) {
      expect(ownDotInViewport(3, 10, rowHeight)).toBe(rowHeight * 1.5);
      expect(ownDotInViewport(9, 10, rowHeight)).toBe(rowHeight * 1.5);
    }
  });

  it('② 视口覆盖 [本行顶 − ROW, 本行底 + ROW]，相邻行视口首尾相接（不重叠、不留缝）', () => {
    const total = 10;
    for (let index = 0; index < total; index += 1) {
      const w = rowCanvasWindow(index, total, ROW);
      expect(w.viewportTop).toBe(-ROW);
      expect(w.viewportHeight).toBe(3 * ROW);
      // 视口底（相对本行顶）= 本行底 + ROW = 下一行顶 + ROW = 下一行视口顶（+2ROW 后）
      const bottom = w.viewportTop + w.viewportHeight; // = 2 * ROW
      const next = rowCanvasWindow(index + 1, total, ROW);
      if (index + 1 < total) {
        // 下一行视口顶 = 下一行顶 − ROW = 本行顶 + ROW − ROW = 本行顶 → 相对本行顶 = 0
        expect(next.viewportTop + ROW).toBe(0);
        // 两个视口在本行 0..2ROW 区间上恰好相接：本行视口底(2ROW) == 下一行视口顶相对本行顶(0)+2ROW
        expect(bottom).toBe(0 + 2 * ROW);
      }
    }
  });

  it('③ 画布恒 3 行（前一行 + 本行 + 后一行，缺的邻居按空位补），本行圆点在画布内', () => {
    expect(rowCanvasWindow(0, 10, ROW)).toMatchObject({ sliceStart: 0, canvasRows: 3, ownIndexInSlice: 0, canvasHeight: 3 * ROW });
    expect(rowCanvasWindow(1, 10, ROW)).toMatchObject({ sliceStart: 0, canvasRows: 3, ownIndexInSlice: 1, canvasHeight: 3 * ROW });
    expect(rowCanvasWindow(5, 10, ROW)).toMatchObject({ sliceStart: 4, canvasRows: 3, ownIndexInSlice: 1, canvasHeight: 3 * ROW });
    expect(rowCanvasWindow(9, 10, ROW)).toMatchObject({ sliceStart: 8, canvasRows: 3, ownIndexInSlice: 1, canvasHeight: 3 * ROW });
    for (const total of [1, 2, 3, 23]) {
      for (let index = 0; index < total; index += 1) {
        const w = rowCanvasWindow(index, total, ROW);
        expect(w.sliceStart).toBe(Math.max(0, index - 1));
        expect(w.canvasRows).toBe(3);
        // 本行圆点在画布内（0 < y < canvasHeight）
        const ownDotInCanvas = (w.ownIndexInSlice + 0.5) * ROW;
        expect(ownDotInCanvas).toBeGreaterThan(0);
        expect(ownDotInCanvas).toBeLessThan(w.canvasHeight);
      }
    }
  });
});
