/**
 * 提交图线段编译（纯函数，可单测）：把布局结果编译成「每一行该画哪些折线」，坐标一律用**全局坐标系**。
 *
 * 为什么要有这一层（历史教训）：
 * 早期实现是「每行各画一块 3 行高的画布，再靠裁切窗口拼成整图」，必然出现两类缺陷：
 *   ① 同一根竖线被上下相邻行各画一次又各自被裁掉一半 → 行边界处接缝/色差（实测同一根线 24px 内 4 种颜色）；
 *   ② 斜边横跨两行被裁成两截、各削一半 → 斜线接不上主竖线。
 * 现在改成：线段只画一次，且**按行切分的位置显式算好**——相邻两行的两半在行边界处共享同一个
 *   (x, y) 端点，因此拼接处严丝合缝；画布只负责给每行一个覆盖该行的 viewBox。
 *
 * 一条边的几何（与 graph-layout 的语义一致）：从起点行中心竖直走到「两行中点」，再斜向走到终点行中心。
 *   - 短边（相邻两行）：竖段落在起点行，斜段落在终点行；
 *   - 长边（跨多行）：竖直段被中间各行切成若干截，斜段只落在「中点所在行」。
 */

import type { EdgeSegment, LayoutRow } from '../graph-layout/types';
import type { RowGraphSegment } from '../base/graph-canvas';
import { laneCenterX, rowCenterY } from '../base/graph-canvas';

/** 一条边在全局坐标下的几何：起点/中点/终点 */
interface EdgeGeometry {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  midY: number;
  color: string;
  dashed: boolean;
}

function geometryOf(
  edge: EdgeSegment,
  rows: LayoutRow[],
  rowHeight: number,
  laneWidth: number,
): EdgeGeometry {
  const fromY = rowCenterY(edge.fromRow, rowHeight);
  const toY = rowCenterY(edge.toRow, rowHeight);
  return {
    fromX: laneCenterX(edge.fromLane, laneWidth),
    fromY,
    toX: laneCenterX(edge.toLane, laneWidth),
    toY,
    midY: (fromY + toY) / 2,
    // 颜色取起点行（Java 语义：边跟随其上方节点的颜色）
    color: rows[edge.fromRow]?.color ?? '#888',
    dashed: edge.type === 'D',
  };
}

/**
 * 把 `[startY, endY]`（严格递增）按行边界切成若干段，每段归属它所在的行。
 * 用于「竖直段跨越多行」的情形：中间行各画自己那一截，首尾两行画半截。
 */
function splitVerticalByRows(
  startY: number,
  endY: number,
  rowHeight: number,
  make: (row: number, y1: number, y2: number) => void,
): void {
  if (endY <= startY) return;
  let y = startY;
  // 浮点安全：以「下一个行边界」为步进，循环次数与跨越行数同阶
  while (y < endY - 1e-9) {
    const row = Math.floor(y / rowHeight);
    const bandEnd = (row + 1) * rowHeight;
    const segEnd = Math.min(bandEnd, endY);
    make(row, y, segEnd);
    y = segEnd;
  }
}

/**
 * 编译每一行要画的线段。
 * @param rows 布局结果（buildLayout 输出）
 * @param rowEdges edgesInRow 输出：每行「跨过该行」的长边
 */
export function buildRowSegments(
  rows: LayoutRow[],
  rowEdges: EdgeSegment[][],
  rowHeight: number,
  laneWidth: number,
): RowGraphSegment[][] {
  const out: RowGraphSegment[][] = rows.map(() => []);

  // 1) 每条边只编译一次：本行自己的边（row.edges 就是该行到各父提交的边）
  rows.forEach((row, rowIndex) => {
    row.edges.forEach((edge, ei) => {
      const g = geometryOf(edge, rows, rowHeight, laneWidth);
      if (g.toY <= g.fromY) return; // 父提交在更上方（异常数据）：跳过，避免画出反向折线
      const key = `e${rowIndex}-${ei}`;
      // 竖段（fromY → midY）：可能跨行（长边的竖直部分）
      splitVerticalByRows(g.fromY, g.midY, rowHeight, (r, y1, y2) => {
        out[r]!.push({ key: `${key}-v${y1}`, color: g.color, pts: [g.fromX, y1, g.fromX, y2], dashed: g.dashed });
      });
      // 斜段（midY → toY）：整段落在中点所在行（跨行时由该行 viewBox 裁剪，但端点全局一致）
      out[Math.floor(g.midY / rowHeight)]!.push({
        key: `${key}-d`,
        color: g.color,
        pts: [g.fromX, g.midY, g.toX, g.toY],
        dashed: g.dashed,
      });
    });
  });

  // 2) 长边（跨越中间行）：edgesInRow 给出的段只用于「本行也要画这根竖线」，
  //    但真正的几何已在 1) 里按起点行编译完毕并切好行，故这里无需重复——保留入参仅为口径对齐。
  void rowEdges;

  return out;
}
