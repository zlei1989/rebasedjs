/**
 * 提交图线段编译（纯函数，可单测）：把布局结果编译成「每一行该画哪些折线」，坐标一律用**全局坐标系**。
 *
 * 为什么要有这一层（历史教训）：
 * 早期实现是「每行各画一块 3 行高的画布，再靠裁切窗口拼成整图」，必然出现两类缺陷：
 *   ① 同一根竖线被上下相邻行各画一次又各自被裁掉一半 → 行边界处接缝/色差（实测同一根线 24px 内 4 种颜色）；
 *   ② 斜边横跨两行被裁成两截、各削一半 → 斜线接不上主竖线。
 * 现在改成：线段只画一次，且**按行切分的位置显式算好**——相邻两行的两半在行边界处共享同一个
 *   (x, y) 端点，因此拼接处严丝合缝；每行只拿到「落在本行带内」的切片，画布只负责给该行一个视口。
 *
 * 一条边的几何（与 graph-layout 的语义一致）：**起点行竖直下去半行 → 用一行带完成横向并轨 → 在目标
 *   lane 上竖直到终点**（起点/终点同 lane 时就是一根竖线）：
 *   - 短边（相邻两行）：竖段半行 + 斜段半行，斜段整段落在终点行那半行里；
 *   - 长边（跨多行）：保持同样的「半行竖 + 一行斜」，然后**在目标 lane 上竖着走完中间各行**。
 *
 * 拐弯的口径（2026-09-12 修，两轮）：
 *   ① 旧实现把斜段铺在「两行中点到终点」之间：行距为偶数时中点正好是某一行的中线，
 *      拐点与该行圆点完全重合 —— 图面凭空多出一条「那一行的提交 → 第二父」的假父子线；
 *      （实测：`5c7c07a`(merge) 的第二父 `d91794f` 隔 2 行 → 拐点落在 `21efcbb` 的圆点上，
 *       图上像是 `21efcbb → d91794f`，而 git 中两者父提交都是 `80b63f4`。）
 *   ② 只把拐点挪开还不够：斜段铺得越长，拐弯离起点行越远，长边会「看起来从中间某一行分叉」，
 *      而且贴着主竖线斜着走时还会擦过中间各行的圆点（实测 `fb9833f`(merge) 的第二父 `3b0244b`
 *      隔 14 行，斜段铺在 7 行之后 → 14px 内贴着 `53047d3` 的圆点过去，图面像是它分出去的）。
 *      故斜段**固定只占一行带**（起于起点行下方半行 = 行边界，止于再下一行边界），横向并轨立刻完成，
 *      中间各行画的是目标 lane 上的竖线 —— 这正是 git/IntelliJ 的 `|\` + 并行车道的形状。
 *
 * 每行的图列宽度（2026-09-12 修）：`RowGeometry.maxX` = 本行带内所有切片与本行圆点的全局 x 上界。
 *   调用方必须按它定宽：早期实现按「本行圆点所在 lane」定宽，跨到更右 lane 的斜线/竖线被逐行 viewBox
 *   裁掉——实测两处断线：青色回折段 y∈[168,176] 断 8px；diverge-test 分支线 y∈[509,575] 断 66px（约 2.7 行）。
 *   代价（有意承受）：被更右车道穿过的行要补宽度，本行文字相应右移——「让线」优先于「让字」，
 *   否则画出来的图形是错的（线断、且看着像挂在别的提交上）。
 */

import type { EdgeSegment, LayoutRow } from '../graph-layout/types';
import type { RowGraphSegment } from '../base/graph-canvas';
import { laneCenterX, rowCenterY } from '../base/graph-canvas';

/** 一条边在全局坐标下的几何：竖段 → 斜段（并轨）→ 目标 lane 竖段 */
interface EdgeGeometry {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** 斜段起点 y（起点行下方半行 = 行边界） */
  bendFromY: number;
  /** 斜段终点 y（最多跨一行带；相邻两行时为终点行中心） */
  bendToY: number;
  color: string;
  dashed: boolean;
}

/** 一行要画的内容 + 该行图列必须覆盖的宽度（全局 x 上界） */
export interface RowGeometry {
  /** 落在本行带内的线段切片（全局坐标，端点与相邻行严格共享） */
  segments: RowGraphSegment[];
  /** 本行带内所有切片 + 本行圆点的最大全局 x（调用方据此定宽，保证不被 viewBox 裁断） */
  maxX: number;
}

/**
 * 全局 x → 覆盖它所需的最小 lane 序号（调用方据此定本行图列宽度）。
 *
 * 口径：本行**文字起点 = 本行图列车道的中心 + DOT_GUTTER**（图列的负右边距把文字拉到圆点右侧
 * DOT_GUTTER 处，见 commit-graph.tsx），因此只要 `laneCenterX(lane) ≥ x`，文字就必然落在
 * 「本行最深的那条线」右侧至少 DOT_GUTTER 处 —— 线画得再右也不会钻到文字底下。
 *
 * 反例（实测踩过两次）：
 *   - 按「本行圆点所在 lane」定宽 → 更右的线被 viewBox 裁断（断 8px / 66px）；
 *   - 按「线只要落在 viewBox 内就行」定宽 → 线可一直画到列右缘，而列右缘比文字起点还靠右 11px
 *     （负右边距的代价），于是线压住每行开头约 10px 的文字。
 * 取 `laneCenterX(lane) ≥ x` 同时满足这两条。
 */
export function laneCoveringX(x: number, laneWidth: number): number {
  return Math.max(0, Math.ceil(x / laneWidth - 0.5));
}

/**
 * 边的几何（见文件头「拐弯的口径」）：竖段半行 → 斜段一行带 → 目标 lane 竖段。
 * 起点/终点同 lane 时不拐弯（整条边就是一根竖线），避免画出一个「竖—斜—竖」的退化折线。
 */
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
    // 起点行下方半行（= 行边界）开始拐，最多跨一行带到下一个行边界；相邻两行时正好落到终点行中心
    bendFromY: fromY + rowHeight / 2,
    bendToY: Math.min(fromY + rowHeight * 1.5, toY),
    // 颜色取起点行（Java 语义：边跟随其上方节点的颜色）
    color: rows[edge.fromRow]?.color ?? '#888',
    dashed: edge.type === 'D',
  };
}

/**
 * 把一条线段 `(x1,y1) → (x2,y2)`（y2 > y1，x 随 y 线性变化）按行边界切成若干段，每段归属它所在的行。
 * 竖段（x1 === x2）与斜段共用这一条路径：相邻两段在行边界处**共用同一个插值结果**，
 * 因此上下两行画出的两半端点严格重合，不会有缝。
 */
function splitSegmentByRows(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rowHeight: number,
  make: (row: number, xa: number, ya: number, xb: number, yb: number) => void,
): void {
  if (y2 <= y1) return;
  const slope = (x2 - x1) / (y2 - y1);
  let y = y1;
  let x = x1;
  // 浮点安全：以「下一个行边界」为步进，循环次数与跨越行数同阶
  while (y < y2 - 1e-9) {
    const row = Math.floor(y / rowHeight);
    const bandEnd = Math.min((row + 1) * rowHeight, y2);
    const xEnd = x1 + (bandEnd - y1) * slope;
    make(row, x, y, xEnd, bandEnd);
    x = xEnd;
    y = bandEnd;
  }
}

/**
 * 编译每一行要画的内容与所需宽度。
 * @param rows 布局结果（buildLayout 输出）
 * @param rowHeight 行高（与行切片、圆点坐标同源）
 * @param laneWidth 车道宽（lane → x）
 */
export function buildRowGeometry(
  rows: LayoutRow[],
  rowHeight: number,
  laneWidth: number,
): RowGeometry[] {
  const out: RowGeometry[] = rows.map((row) => ({
    segments: [],
    // 圆点本身也要占宽度：lane 越深，图列越宽
    maxX: laneCenterX(row.lane, laneWidth),
  }));

  // 每条边只编译一次：本行自己的边（row.edges 就是该行到各父提交的边）
  rows.forEach((row, rowIndex) => {
    row.edges.forEach((edge, ei) => {
      const g = geometryOf(edge, rows, rowHeight, laneWidth);
      if (g.toY <= g.fromY) return; // 父提交在更上方（异常数据）：跳过，避免画出反向折线
      // key 里带上起点/终点行号：React key 用得上，测试也能据此判断「这条切片属于哪条边」
      const key = `e${rowIndex}-${edge.toRow}-${ei}`;
      const push = (row: number, xa: number, ya: number, xb: number, yb: number, part: string): void => {
        out[row]!.segments.push({
          key: `${key}-${part}`,
          color: g.color,
          pts: [xa, ya, xb, yb],
          dashed: g.dashed,
        });
        // 切片是一条直线，x 的极值必在两端；取两端较大者即该切片在本行带内的 x 上界
        out[row]!.maxX = Math.max(out[row]!.maxX, xa, xb);
      };
      const splitVertical = (x: number, y1: number, y2: number, part: string): void => {
        splitSegmentByRows(x, y1, x, y2, rowHeight, (r, xa, ya, xb, yb) => push(r, xa, ya, xb, yb, `${part}${ya}`));
      };
      if (g.fromX === g.toX) {
        // 同 lane：整条边就是一根竖线（不画退化的「竖—斜—竖」）
        splitVertical(g.fromX, g.fromY, g.toY, 'v');
        return;
      }
      // ① 起点行：从圆点竖直下来半行到行边界
      splitVertical(g.fromX, g.fromY, g.bendFromY, 'v');
      // ② 并轨斜段：最多占一行带（见文件头「拐弯的口径」②）
      splitSegmentByRows(g.fromX, g.bendFromY, g.toX, g.bendToY, rowHeight, (r, xa, ya, xb, yb) =>
        push(r, xa, ya, xb, yb, `b${ya}`),
      );
      // ③ 目标 lane 上的竖段：长边在中间各行都占着这条车道（宽度由 maxX 带出）
      if (g.toY > g.bendToY) splitVertical(g.toX, g.bendToY, g.toY, 'w');
    });
  });

  return out;
}
