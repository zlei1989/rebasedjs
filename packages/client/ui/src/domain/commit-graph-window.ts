/**
 * 提交图行内「画布窗口」的几何换算（纯函数，便于单测；组件与测试共用同一份口径）。
 *
 * 背景：GraphCanvas 每行画的是「前一行 + 本行 + 后一行」，而每行行盒只有 rowHeight 高。
 * 改造前每行是绝对定位的定高盒子，画布溢出被隐式裁掉；换成普通流（antd Listy 的行）后行不再裁剪，
 * 整块画布盖到相邻行上 —— 同一列出现 12px 步进的重复圆点，肉眼即「图与右侧文字行错位」。
 *
 * 但**不能**简单把每行裁成自己那一条 rowHeight：
 * 相邻行共享一段半行高的斜边（分叉/合流：本行的斜段落在行下半，下一行的斜段落在下一行上半）。
 * 按行硬裁会把这条斜边切成两截、各自削掉一半 —— 分叉线于是断成「斜段 + 竖段」，看起来就是连接不对。
 *
 * 采用「视口比行高一圈」的口径：
 *   - 行盒仍为 rowHeight，且**不裁剪**（画布可以跨越行边界把斜边画完）；
 *   - 每行画布恒画 3 行内容（前一行 + 本行 + 后一行），缺失的邻居按空位补，保证画布尺寸恒定、圆点位置可预期；
 *   - 用 **SVG 自身 viewport** 裁剪（height 固定 3 行 + overflow:hidden）并整体上移一行：
 *     视口覆盖 [上一行顶, 下一行底]，相邻行的视口首尾相接、互不重叠 —— 既不重复画圆点，也不切斜边。
 *
 * 于是本行圆点必须落在视口内 y = 1.5 × rowHeight（视口第二行中点），而视口顶 = 本行顶 − rowHeight，
 * 圆点正好落回本行行盒中点。
 */

export interface RowCanvasWindow {
  /** 画布切片起点（全量行号）：index − 1，首行夹到 0 */
  sliceStart: number;
  /** 画布覆盖的行数：恒为 3（缺失的邻居在渲染处按空位补，避免首/末行画布尺寸变化导致圆点偏移） */
  canvasRows: number;
  /** 画布内容高度（= canvasRows × rowHeight；SVG 视口高度另见 viewportHeight） */
  canvasHeight: number;
  /** 本行在切片内的下标（首行 0，其余 1） */
  ownIndexInSlice: number;
  /** SVG 视口顶相对本行顶的偏移：恒为 −rowHeight（视口向上多盖一行） */
  viewportTop: number;
  /** SVG 视口高度：恒为 3 × rowHeight（上下一行留给跨行斜边，且与邻居视口首尾相接） */
  viewportHeight: number;
  /** 画布内容的绘制偏移（translate Y），使本行圆点落在视口内 y = 1.5 × rowHeight */
  contentOffsetY: number;
}

/** 每行画布固定覆盖的行数：前一行 + 本行 + 后一行 */
const CANVAS_ROWS = 3;

/** 计算某一行（index，共 total 行）的画布窗口几何 */
export function rowCanvasWindow(index: number, total: number, rowHeight: number): RowCanvasWindow {
  const sliceStart = Math.max(0, index - 1);
  const ownIndexInSlice = index - sliceStart;
  const canvasHeight = CANVAS_ROWS * rowHeight;
  // 本行圆点在画布内的局部 y（画布按切片自上而下排）
  const ownDotInCanvas = (ownIndexInSlice + 0.5) * rowHeight;
  return {
    sliceStart,
    canvasRows: CANVAS_ROWS,
    canvasHeight,
    ownIndexInSlice,
    viewportTop: -rowHeight,
    viewportHeight: CANVAS_ROWS * rowHeight,
    // 目标：视口内 y = 1.5 × rowHeight（视口第二行中点 = 本行行盒中点）
    contentOffsetY: 1.5 * rowHeight - ownDotInCanvas,
  };
}
