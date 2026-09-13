/**
 * 线性分支折叠（纯函数，无状态）。TS 移植自 IntelliJ platform/vcs-log/graph：
 *   - `linearFragmentAt` / `fragmentForEdge`  ← `collapsing/LinearFragmentGenerator.java` 的
 *     `getLongFragment` / `getRelativeFragment`；
 *   - `collapseAllFragments`                  ← `collapsing/CollapsedActionManager.java` 的 `COLLAPSE_ALL`。
 *
 * 行序口径：行号 0 = 最新提交，父提交在更大的行号（与 domain/commit-graph 的输入一致）。
 * 因此 Java 的「down（更旧）」= 行号更大，「up（更新）」= 行号更小。
 *
 * 与 Java 的等价性口径（**关键，实现时不要"化简"掉这三条**）：
 *   ① 「链节」`isChained(i)` = rows[i] 的唯一父是 rows[i+1]，且 rows[i+1] 的唯一子是 rows[i]
 *      （Java `getFragment` 在 grayNodes 只剩一个元素时单步返回的等价物）；
 *   ② 「pinned 行」= 带 refs 的提交（Java `permanentGraphInfo.branchNodeIds`）。pinned 行**可以做端点、
 *      但不能落在链的中间**——Java `getLongFragment` 的扩展条件是「**离开**当前端点时该端点不是 pinned」
 *      （`!myPinnedNodes.contains(maxDown)`），所以 pinned 端点进得来、进来之后循环即停；
 *   ③ **起点片段已含向下的一节**：`getRelativeFragment` 先取 `getDownFragment(锚点)` 得到 `(start, start+1)`，
 *      `getLongFragment` 才在此基础上向两端扩展。故 down 的扩展必须从 `start + 1` 起算、up 从 `start` 起算——
 *      若 down 也从 start 起算，pinned 起点将完全无法折叠（会漏掉「标签提交 → 其后一整条链」这类最常见的链）。
 *
 * 若链长 < 3 行（无中间节点可隐藏）→ `null`（Java `getLongFragment` 退化分支的等价物）。
 *
 * 有据的简化（设计 §3.1「算法纯函数移植、不移植 CollapsedGraph 类结构」）：Java `getFragment` 在
 * grayNodes 仍有 ≥2 个候选时会继续深入寻找汇合点（用于跨分叉的长片段高亮）；本仓把片段定义为
 * **极大线性直链**，跨分叉结构不产生片段（点上去无动作）。用户可见的折叠能力不受影响——折叠本就只发生在直链上。
 *
 * 折叠链以**提交 hash 对**记录而不是行号：新提交插到列表顶部会让行号整体偏移，
 * hash 对在数据变化后仍指向同一条链（`fragmentsToRows` 每次现算行号，端点消失即丢弃）。
 */

import type { LayoutRow } from './types';

/** 已折叠的线性链：以端点提交 hash 记录（抗行号偏移） */
export interface CollapsedFragment {
  /** 更新一端的提交 hash */
  up: string;
  /** 更旧一端的提交 hash */
  down: string;
}

/** 行号区间（delegate 行号）：[up, down]，up < down */
export interface LinearFragment {
  up: number;
  down: number;
}

/** 行索引：hash→行号、hash→子提交列表（链判定用，避免每次 O(n) 重扫） */
export interface RowIndex {
  rowOf: Map<string, number>;
  childrenOf: Map<string, string[]>;
}

/** Java `LinearFragmentGenerator.MAX_SEARCH_SIZE`：起点上溯的最大步数 */
const MAX_SEARCH_SIZE = 10;

/** 建索引一次，供同一批 rows 的多次链判定复用 */
export function buildRowIndex(rows: LayoutRow[]): RowIndex {
  const rowOf = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();
  rows.forEach((r, i) => {
    rowOf.set(r.commit.hash, i);
    for (const p of r.commit.parents) {
      const kids = childrenOf.get(p);
      if (kids === undefined) childrenOf.set(p, [r.commit.hash]);
      else if (!kids.includes(r.commit.hash)) kids.push(r.commit.hash);
    }
  });
  return { rowOf, childrenOf };
}

/** rows[i] 与 rows[i+1] 是否构成一个链节（唯一父子且互为相邻行） */
function isChained(rows: LayoutRow[], idx: RowIndex, i: number): boolean {
  const child = rows[i];
  const parent = rows[i + 1];
  if (child === undefined || parent === undefined) return false;
  if (child.commit.parents.length !== 1 || child.commit.parents[0] !== parent.commit.hash) return false;
  const kids = idx.childrenOf.get(parent.commit.hash) ?? [];
  return kids.length === 1 && kids[0] === child.commit.hash;
}

/** pinned = 带任意 refs 的提交（分支/标签/HEAD 所指）；对齐 Java branchNodeIds */
function isPinned(row: LayoutRow): boolean {
  return row.commit.refs.length > 0;
}

/** Java `getDownFragment`：以 from 为起点向下一节（from → from+1）；无链节 → null */
function downStep(rows: LayoutRow[], idx: RowIndex, from: number): number | null {
  return isChained(rows, idx, from) ? from + 1 : null;
}

/** Java `getUpFragment`：以 from 为起点向上一节（from → from-1）；无链节 → null */
function upStep(rows: LayoutRow[], idx: RowIndex, from: number): number | null {
  return from - 1 >= 0 && isChained(rows, idx, from - 1) ? from - 1 : null;
}

/**
 * 以 anchorRow 为锚点的极大线性链（Java `getLongFragment` + `getRelativeFragment`）。
 * @returns hash 对；链长 < 3 行（无中间节点可隐藏）或锚点推不出起点 → null
 */
export function linearFragmentAt(rows: LayoutRow[], anchorRow: number, idx: RowIndex = buildRowIndex(rows)): CollapsedFragment | null {
  if (anchorRow < 0 || anchorRow >= rows.length) return null;

  // ① 起点：锚点自身有向下链节就用锚点；否则沿唯一子上溯（Java getRelativeFragment 的 MAX_SEARCH_SIZE 循环）
  let start = -1;
  let cursor = anchorRow;
  for (let k = 0; k < MAX_SEARCH_SIZE; k++) {
    if (downStep(rows, idx, cursor) !== null) {
      start = cursor;
      break;
    }
    const kids = idx.childrenOf.get(rows[cursor].commit.hash) ?? [];
    if (kids.length !== 1) break;
    const kidRow = idx.rowOf.get(kids[0]);
    if (kidRow === undefined || kidRow >= cursor) break; // 子必须在更小行号（更新）
    cursor = kidRow;
  }
  if (start === -1) return null;

  // ② 两端扩展：起点片段 (start, start+1) 已含向下第一节（口径 ③），故 down 从 start+1 起算
  let down = start + 1;
  while (down + 1 < rows.length && isChained(rows, idx, down) && !isPinned(rows[down])) down++;
  // up 侧没有「预先含一节」，从 start 起算：逐节上溯，离开当前端点时该端点不是 pinned 才继续
  let up = start;
  for (;;) {
    const next = upStep(rows, idx, up);
    if (next === null || isPinned(rows[up])) break;
    up = next;
  }

  if (down - up < 2) return null;
  return { up: rows[up].commit.hash, down: rows[down].commit.hash };
}

/**
 * 由一条边的两端行号取所在链（Java `getRelativeFragment`：元素是边时先取该边的较新端再找片段）。
 */
export function fragmentForEdge(rows: LayoutRow[], upRow: number, downRow: number, idx: RowIndex = buildRowIndex(rows)): CollapsedFragment | null {
  return linearFragmentAt(rows, Math.min(upRow, downRow), idx);
}

/**
 * 折叠全部（Java `CollapsedActionManager.COLLAPSE_ALL`）：自上而下逐行取向下的极大链，
 * 隐藏其中间行并加一条虚线边，已隐藏的行跳过；**只向下扩展**（对齐 `getLongDownFragment`，不向上）。
 */
export function collapseAllFragments(rows: LayoutRow[], idx: RowIndex = buildRowIndex(rows)): CollapsedFragment[] {
  const hidden = new Set<number>();
  const out: CollapsedFragment[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (hidden.has(i)) continue;
    // Java getLongDownFragment = getLongFragment(getDownFragment(i))：起点片段 (i, i+1) 已含第一节
    if (downStep(rows, idx, i) === null) continue;
    let down = i + 1;
    while (down + 1 < rows.length && isChained(rows, idx, down) && !isPinned(rows[down])) down++;
    if (down - i < 2) continue;
    for (let k = i + 1; k < down; k++) hidden.add(k);
    out.push({ up: rows[i].commit.hash, down: rows[down].commit.hash });
  }
  return out;
}

/** hash 对 → 行号对：端点任一不存在即丢弃（数据变化后的自我保护） */
export function fragmentsToRows(rows: LayoutRow[], fragments: CollapsedFragment[], idx: RowIndex = buildRowIndex(rows)): LinearFragment[] {
  const out: LinearFragment[] = [];
  for (const f of fragments) {
    const up = idx.rowOf.get(f.up);
    const down = idx.rowOf.get(f.down);
    if (up === undefined || down === undefined || down - up < 2) continue;
    out.push({ up, down });
  }
  return out;
}
