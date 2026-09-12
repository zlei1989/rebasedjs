/**
 * 显示车道压实（**渲染层补充，不属于 Java 移植**）。
 *
 * 为什么需要：`buildLayout` 的 `lane = layoutIndex − 1` 是 Java `GraphLayoutBuilder` 的 DFS 行走结果 ——
 * fragment 每被发现一次就全局 +1、**永不复用**，所以车道号是「fragment 被发现的先后」，不是「第几列被占用」。
 * 侧支因此常被放到靠右的列上，中间留出空列，例如主仓（rebased-smoke）的实际排布：
 *   fragment 发现顺序 = 主线(1) → feature(2) → diverge-test(3) → 远端侧(4)
 *   → 只出现一条侧支的区间里，diverge-test 落在**车道 2**、远端侧落在**车道 3**，而车道 1/2 当时空着。
 * 这份空档会原样传到界面上：图里看得见空列，且「文字让开本行最深的那条线」（domain/commit-graph-segments）
 * 会把缩进也一起推深 —— 主仓实测缩进 3 档（54px），而它的结构是「主线 + 至多一条并行侧支」，只需 1 档。
 * 对照：rebased-multi2 的车道恰好是稠密的（每行 {0..k} 无空洞），压实对它是**恒等变换**，画面逐像素不变。
 *
 * 口径：只压**显示车道**，不动 Java 车道号 —— `LayoutRow.color`（主线染 head ref 哈希色、fragment 染
 * layoutIndex 色）、`edgesInRow`、`graph-layout/fixtures/java/*` 的 parity 快照全部不受影响。
 *
 * 算法（绿线：不新增交叉、一条线不换列、能复用就复用）：
 *   1. 一条「线」= 一个 fragment（Java lane 相同）；它的占用区间 = 该 lane 在行号轴上出现过的 [最小行, 最大行]：
 *      本 lane 的节点行，加上「以该 lane 为终点的长边」的竖直段所占的行（竖直段画在**目标车道**上，
 *      自起点行下方两行起 —— 弯在一个行带内完成，见 domain/commit-graph-segments 的几何口径）；
 *   2. 按 Java lane 升序（= 图中从左到右）逐条分配：显示车道 = max(与之**区间重叠**的已分配线的显示车道) + 1。
 *      · 与所有重叠线比大小 ⇒ 左右相对顺序保持 ⇒ 竖线之间不会新增交叉；
 *      · 只看「区间重叠」的线 ⇒ 区间不相交（时间上错开）的线可复用同一列 ⇒ 列数被压到最紧。
 *
 * 可证的两条性质（实现时依赖）：① **显示车道 ≤ Java 车道**（只会左移，绝不会更宽）—— 归纳：重叠的前序线
 * Java 车道都比本线小、显示车道又都不超过各自 Java 车道，故 max+1 ≤ 本线 Java 车道；
 * ② 同一 Java 车道的所有节点与边端点映射到同一个显示车道（映射按 Java 车道查表，不是按行算）。
 */

import type { LayoutRow } from './types';

/** 一条线（fragment）在行号轴上的占用区间 */
interface LineSpan {
  /** Java 车道（= layoutIndex − 1），也是分配顺序 */
  javaLane: number;
  startRow: number;
  endRow: number;
}

/**
 * 长边竖直段的起始行偏移：弯固定占一个行带（自起点行下方半行起），
 * 故目标车道自 `fromRow + 2` 起被占用；相邻两行时斜段即终点行那半行，不额外占列。
 */
const VERTICAL_FIRST_ROW_OFFSET = 2;

/** 收集每条线的占用区间（区间用 [min, max] 近似：宁可保守，也不能让两条线撞进同一列） */
function lineSpans(rows: LayoutRow[]): LineSpan[] {
  const spans = new Map<number, LineSpan>();
  const touch = (javaLane: number, row: number): void => {
    const span = spans.get(javaLane);
    if (!span) spans.set(javaLane, { javaLane, startRow: row, endRow: row });
    else {
      span.startRow = Math.min(span.startRow, row);
      span.endRow = Math.max(span.endRow, row);
    }
  };

  rows.forEach((row, index) => {
    touch(row.lane, index);
    for (const edge of row.edges) {
      if (edge.toRow <= edge.fromRow + 1) continue; // 相邻行：无独立竖段
      touch(edge.toLane, edge.fromRow + VERTICAL_FIRST_ROW_OFFSET);
      touch(edge.toLane, edge.toRow);
    }
  });

  return [...spans.values()].sort((a, b) => a.javaLane - b.javaLane);
}

/** 两个区间是否在行号轴上重叠（含端点相接：相接处两行共享同一行边界，仍算同时可见） */
function overlaps(a: LineSpan, b: LineSpan): boolean {
  return a.startRow <= b.endRow && b.startRow <= a.endRow;
}

/**
 * 把 Java 车道压成「同时并存的线连续编号」的显示车道。
 * @param rows buildLayout 输出（也可直接喂 fixtures）
 * @returns 新行数组：`lane` 与 `edges[].fromLane/toLane` 换成显示车道，其余字段（commit/color/边类型）原样保留
 */
export function compactLanes(rows: LayoutRow[]): LayoutRow[] {
  const assigned = new Map<number, number>();
  const placed: Array<{ lane: number; span: LineSpan }> = [];
  for (const span of lineSpans(rows)) {
    // 与已分配线中「区间重叠」的那些：显示车道必须排在它们右侧（保持左右顺序）
    const overlapping = placed.filter((item) => overlaps(item.span, span));
    const lane = overlapping.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    assigned.set(span.javaLane, lane);
    placed.push({ lane, span });
  }

  const displayLaneOf = (javaLane: number): number => assigned.get(javaLane) ?? javaLane;
  return rows.map((row) => ({
    ...row,
    lane: displayLaneOf(row.lane),
    edges: row.edges.map((edge) => ({
      ...edge,
      fromLane: displayLaneOf(edge.fromLane),
      toLane: displayLaneOf(edge.toLane),
    })),
  }));
}
