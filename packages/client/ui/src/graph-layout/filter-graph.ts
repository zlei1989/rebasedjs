/**
 * 分支过滤（纯函数）。TS 移植自 IntelliJ platform/vcs-log/graph：
 *   - `branchAnchors` / `reachableRows` ← `utils/GraphUtil.kt` 的 `getReachableMatchingNodes`
 *     （`DfsWalk(startNodes, graph).walk(true)`：沿 down 边 = 父方向 DFS，含起点）；
 *   - `dottedFilterEdges`             ← `collapsing/DottedFilterEdgesGenerator.kt` 的
 *     `update()` = `downWalk(); cleanup(); upWalk();`（`ShiftNumber` 用 Map 等价实现）。
 *
 * 为什么保留虚线过滤边：忠实移植 Java `DottedFilterEdgesGenerator`。它服务于**文本/结构/revision 过滤**
 * 与 Hide Commits 那条路径（那类可见集不是祖先封闭的），本仓当前只有分支过滤 ⇒ 该生成器**恒无输出、
 * 属不可达分支**（Ruling F1，见 docs/pages-and-api-audit.md §7.9），保留以备未来接入非祖先封闭的过滤。
 *
 * 行序口径：行号 0 = 最新，父提交在更大行号。故：
 *   - 「UP 邻接」= 子提交（行号更小，已在 downWalk 中处理过）；
 *   - 「DOWN 邻接」= 父提交（行号更大，已在 upWalk 中处理过）。
 *
 * 范围口径（有据的简化）：Java 只用部分范围更新时才产生的 `DOTTED_ARROW_UP/DOWN` 箭头边
 * （`addEdgeOrArrow` 的越界分支）在本仓恒不触发——本仓每次都是全范围更新
 * （Java 对应 `FilteredController.create` 的 `update(graph, 0, nodesCount - 1)`），故该分支
 * 实现为显式 no-op 并在此注明（设计 §8）。
 */

import type { LayoutRow } from './types';
import { refNameOf } from './ref-name';
import type { LinearFragment, RowIndex } from './collapse';
import { buildRowIndex } from './collapse';

/** 提交的 refs 里的分支名（剥 `HEAD -> ` 前缀；`tag: ` 归标签，不算分支） */
function branchNamesOf(refs: string[]): string[] {
  const out: string[] = [];
  for (const raw of refs) {
    const ref = refNameOf(raw);
    if (!ref.startsWith('tag: ')) out.push(ref);
  }
  return out;
}

/** 锚点行：refs 命中任一选中分支名的行（可能多行命中同一分支——合并后多条行都带同一 ref 装饰） */
export function branchAnchors(rows: LayoutRow[], names: string[]): number[] {
  if (names.length === 0) return [];
  const wanted = new Set(names);
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (branchNamesOf(r.commit.refs).some((n) => wanted.has(n))) out.push(i);
  });
  return out;
}

/** 从 anchors 沿父边 DFS 的可达行集合（含 anchors 自身；Java getReachableMatchingNodes 的 matchedNodes=null 形态） */
export function reachableRows(rows: LayoutRow[], anchors: number[], idx: RowIndex = buildRowIndex(rows)): Set<number> {
  const visited = new Set<number>();
  const stack = [...anchors];
  while (stack.length > 0) {
    const r = stack.pop()!;
    if (visited.has(r)) continue;
    visited.add(r);
    const row = rows[r];
    if (row === undefined) continue;
    for (const p of row.commit.parents) {
      const pr = idx.rowOf.get(p);
      if (pr !== undefined && !visited.has(pr)) stack.push(pr);
    }
  }
  return visited;
}

/** 每个提交的父行（去重；不在图中的父 = 未加载，与 Java NOT_LOAD 边同理丢弃） */
function parentRows(rows: LayoutRow[], idx: RowIndex): number[][] {
  return rows.map((r) => {
    const seen = new Set<number>();
    for (const p of r.commit.parents) {
      const pr = idx.rowOf.get(p);
      if (pr !== undefined) seen.add(pr);
    }
    return [...seen];
  });
}

/**
 * 虚线过滤边（Java `DottedFilterEdgesGenerator.update` 的全范围形态）。
 *
 * 算法（与 Java 逐句对应）：
 *   - `numbers[i]` = 「节点 i 在 up/down 方向上最近的那个**可见**节点的行号」，按方向分别传播；
 *   - downWalk（行号升序，看子节点）：可见节点取 `max`（子节点里已可见者的 numbers）与
 *     `nearlyUp`（不可见子节点传播上来的 numbers）；两者不等 ⇒ 该可见节点与 `nearlyUp` 之间
 *     跨了隐藏段 ⇒ 加一条虚线边；
 *   - upWalk（行号降序，看父节点）：对称地用 `min`；
 *   - 两个方向各加一次 ⇒ 同一条边被加两遍，故用 Set 去重（Java 由 `EdgeStorage` 去重）。
 */
export function dottedFilterEdges(rows: LayoutRow[], isVisible: (row: number) => boolean): LinearFragment[] {
  const n = rows.length;
  if (n === 0) return [];
  const idx = buildRowIndex(rows);
  const parents = parentRows(rows, idx);
  const children: number[][] = rows.map(() => []);
  parents.forEach((ps, i) => {
    for (const p of ps) children[p].push(i);
  });

  const dotted = new Map<string, LinearFragment>();
  const add = (a: number, b: number): void => {
    const up = Math.min(a, b);
    const down = Math.max(a, b);
    if (up === down) return;
    dotted.set(`${up}-${down}`, { up, down });
  };

  // ---- downWalk：升序遍历，子节点（更小行号）已算过 ----
  let numbers = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (isVisible(i)) {
      let nearlyUp = Number.NEGATIVE_INFINITY;
      let maxAdjNumber = Number.NEGATIVE_INFINITY;
      for (const upNode of children[i]) {
        if (isVisible(upNode)) maxAdjNumber = Math.max(maxAdjNumber, numbers.get(upNode) ?? Number.NEGATIVE_INFINITY);
        else nearlyUp = Math.max(nearlyUp, numbers.get(upNode) ?? Number.NEGATIVE_INFINITY);
      }
      if (nearlyUp === maxAdjNumber || nearlyUp === Number.NEGATIVE_INFINITY) numbers.set(i, maxAdjNumber);
      else {
        add(i, nearlyUp);
        numbers.set(i, nearlyUp);
      }
    } else {
      let nearlyUp = Number.NEGATIVE_INFINITY;
      for (const upNode of children[i]) {
        if (isVisible(upNode)) nearlyUp = Math.max(nearlyUp, upNode);
        else nearlyUp = Math.max(nearlyUp, numbers.get(upNode) ?? Number.NEGATIVE_INFINITY);
      }
      numbers.set(i, nearlyUp);
    }
  }

  // ---- cleanup：Java 在 upWalk 前把 numbers 全量置为 MAX_VALUE（此处直接换一张空表等价）----
  numbers = new Map<number, number>();

  // ---- upWalk：降序遍历，父节点（更大行号）已算过 ----
  for (let i = n - 1; i >= 0; i--) {
    if (isVisible(i)) {
      let nearlyDown = Number.POSITIVE_INFINITY;
      let minAdjNumber = Number.POSITIVE_INFINITY;
      for (const downNode of parents[i]) {
        if (isVisible(downNode)) minAdjNumber = Math.min(minAdjNumber, numbers.get(downNode) ?? Number.POSITIVE_INFINITY);
        else nearlyDown = Math.min(nearlyDown, numbers.get(downNode) ?? Number.POSITIVE_INFINITY);
      }
      if (nearlyDown === minAdjNumber || nearlyDown === Number.POSITIVE_INFINITY) numbers.set(i, minAdjNumber);
      else {
        add(i, nearlyDown);
        numbers.set(i, nearlyDown);
      }
    } else {
      let nearlyDown = Number.POSITIVE_INFINITY;
      for (const downNode of parents[i]) {
        if (isVisible(downNode)) nearlyDown = Math.min(nearlyDown, downNode);
        else nearlyDown = Math.min(nearlyDown, numbers.get(downNode) ?? Number.POSITIVE_INFINITY);
      }
      numbers.set(i, nearlyDown);
    }
  }

  return [...dotted.values()].sort((a, b) => a.up - b.up || a.down - b.down);
}
