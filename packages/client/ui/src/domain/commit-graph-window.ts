/**
 * 提交图行内「画布窗口」的几何换算（纯函数，便于单测；组件与测试共用同一份口径）。
 *
 * 背景：GraphCanvas 每行画的是「前一行 + 本行 + 后一行」（首/末行只有 2 行），而每行容器只有 rowHeight 高。
 * 改造前每行是绝对定位的定高盒子，画布溢出被隐式裁掉；换成普通流（antd Listy 的行）后行不再裁剪，
 * 整块画布会盖到相邻行上 —— 同一列出现 12px 步进的重复圆点，肉眼即「图与右侧文字行错位」。
 *
 * 所以每行要有一个「裁剪窗口」：定高 rowHeight + overflow:hidden，内部的画布按下面的 top 偏移摆放，
 * 使**本行圆点**（画布内局部 y = (index - sliceStart) * rowHeight + rowHeight / 2）与本行窗口中点重合。
 */

export interface RowCanvasWindow {
  /** 画布切片起点（全量行号）：index - 1，首行夹到 0 */
  sliceStart: number;
  /** 画布覆盖的行数：首/末行为 2，其余为 3 */
  canvasRows: number;
  /** 画布像素高度 */
  canvasHeight: number;
  /** 画布在裁剪窗口内的 top 偏移（负值 = 上移） */
  canvasTop: number;
}

/** 计算某一行（index，共 total 行）的画布窗口几何 */
export function rowCanvasWindow(index: number, total: number, rowHeight: number): RowCanvasWindow {
  const sliceStart = Math.max(0, index - 1);
  const canvasRows = Math.min(index + 2, total) - sliceStart;
  const ownOffsetInCanvas = (index - sliceStart) * rowHeight;
  return {
    sliceStart,
    canvasRows,
    canvasHeight: canvasRows * rowHeight,
    // 本行圆点应落在窗口中点：窗口内 y = rowHeight/2（窗口中点）− 本行圆点在画布内的 y
    canvasTop: rowHeight / 2 - (ownOffsetInCanvas + rowHeight / 2),
  };
}
