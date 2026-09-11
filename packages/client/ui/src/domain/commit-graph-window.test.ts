// @vitest-environment node
/**
 * 画布窗口几何回归：把「本行圆点落在本行窗口中点」这条不变量钉住。
 * 这条曾被破坏过——行不再裁剪时整块画布盖到相邻行，图上出现 12px 步进的重复圆点，
 * 表现为「左侧图与右侧文字行错位」（用户实测反馈）。
 */
import { describe, expect, it } from 'vitest';
import { rowCanvasWindow } from './commit-graph-window';

const ROW = 24;

/** 本行圆点在「窗口坐标系」里的 y（0 = 窗口顶边，ROW = 窗口底边） */
function ownDotInWindow(index: number, total: number, rowHeight = ROW): number {
  const w = rowCanvasWindow(index, total, rowHeight);
  const ownOffsetInCanvas = (index - w.sliceStart) * rowHeight + rowHeight / 2;
  return w.canvasTop + ownOffsetInCanvas;
}

describe('rowCanvasWindow', () => {
  it('本行圆点恒落在窗口中点（首/中/末行以及只有 1 行的边界）', () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [0, 23],
      [1, 23],
      [7, 23],
      [22, 23], // 末行：没有后一行
      [0, 500],
      [499, 500],
      [250, 500],
    ];
    for (const [index, total] of cases) {
      expect(ownDotInWindow(index, total), `index=${index} total=${total}`).toBe(ROW / 2);
    }
  });

  it('切片起点为 index-1，首行夹到 0；画布行数 2（首/末行外）或 3', () => {
    expect(rowCanvasWindow(0, 10, ROW)).toMatchObject({ sliceStart: 0, canvasRows: 2 });
    expect(rowCanvasWindow(1, 10, ROW)).toMatchObject({ sliceStart: 0, canvasRows: 3 });
    expect(rowCanvasWindow(5, 10, ROW)).toMatchObject({ sliceStart: 4, canvasRows: 3 });
    expect(rowCanvasWindow(9, 10, ROW)).toMatchObject({ sliceStart: 8, canvasRows: 2 });
  });

  it('画布高度与上移量自洽：画布底边不低于窗口底边、且不高于窗口顶边（否则本行圆点会被裁）', () => {
    for (const total of [1, 2, 3, 23, 500]) {
      for (let index = 0; index < Math.min(total, 30); index += 1) {
        const w = rowCanvasWindow(index, total, ROW);
        expect(w.canvasHeight).toBe(w.canvasRows * ROW);
        // 本行圆点（含半径 4）必须完整落在窗口内：jsdom 无布局，故这里只做几何断言
        const dotTop = ownDotInWindow(index, total) - 4;
        const dotBottom = ownDotInWindow(index, total) + 4;
        expect(dotTop).toBeGreaterThanOrEqual(0);
        expect(dotBottom).toBeLessThanOrEqual(ROW);
        // 画布至少覆盖整条窗口（否则窗口里会出现空白带）
        expect(w.canvasTop).toBeLessThanOrEqual(0);
        expect(w.canvasTop + w.canvasHeight).toBeGreaterThanOrEqual(ROW);
      }
    }
  });

  it('行高换值也成立（不写死 24）', () => {
    for (const rowHeight of [16, 20, 24, 32, 48]) {
      expect(ownDotInWindow(3, 10, rowHeight)).toBe(rowHeight / 2);
      expect(ownDotInWindow(9, 10, rowHeight)).toBe(rowHeight / 2);
    }
  });
});
