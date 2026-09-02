// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 移植自 platform/vcs-log/graph（impl/permanent/GraphLayoutBuilder.kt、GraphLayoutImpl.kt、
// impl/print/EdgesInRowGenerator.java、impl/facade/ReachableNodes.kt）。
//
// 语义对照：
// - GraphLayoutBuilder.build：自排序后的 heads 起做 DFS 单链行走（显式栈），为每个节点分配 layoutIndex；
//   走到死胡同且该节点为首次访问时 layoutIndex 递增——「边冲突时开新 lane、合并行收拢」由此而来。
// - GraphLayoutImpl.getOneOfHeadNodeIndex：对 importantHeads 的 layoutIndex 数组做 JDK binarySearch，
//   未命中时取 max(0, -insertionPoint - 2) 得到 head 序号。
// - lane = layoutIndex - 1（0 基列号）。
// - color：完整 Java 着色语义（GraphColorManagerImpl.getColor 实测）：主线节点
//   （layoutIndex == 其 head 的 layoutIndex）染 head 首个 ref 名哈希色（无 ref 为默认黑），
//   fragment 节点染自身 layoutIndex 色。色板见 color.ts。
// - edgesInRow：Java EdgesInRowGenerator 的语义 = 每行收集「严格跨过该行的正常边」
//   （upRow < i < downRow；NOT_LOAD 等特殊边被 NORMAL 过滤器排除）——即长边在中间行的填充段。
// - containingBranches：Java ReachableNodes/ContainingBranchesTest —— 分支 b 包含节点 n ⟺
//   n 在 b 的祖先链（沿父边）上；输出每行按行号升序的分支列表。
// - buildLinearGraph：Java PermanentLinearGraphBuilder/GraphBuilderTest —— 父提交去重（首次出现）、
//   简单节点（唯一父 == 下一行）隐式边、不在图中的父 → NOT_LOAD（目标 = -parseInt(hash, 16)）。
// - head 排序按哈希字典序，对应 Java 测试中按提交名比较的 comparator（真实 IntelliJ 用时间戳，可替换）。
// - 偏离 Java branches 参数：带 refs 的提交不参与 head 集合（简报模型中 refs 仅作展示元数据）。

import { colorById, colorForRef } from './color';
import type { EdgeSegment, LayoutCommit, LayoutRow } from './types';

/**
 * 提交图布局：lane 分配 + 边路由 + 分支着色。
 * 语义对齐 Java GraphLayoutBuilder/GraphLayoutImpl（platform/vcs-log/graph）。
 * 输入自下而上（最旧在前）或自上而下均可——算法只依赖父子关系，与行序无关；
 * 行号仅用于边段的 fromRow/toRow 报告。
 */
export function buildLayout(commits: LayoutCommit[]): LayoutRow[] {
  const rowOf = new Map(commits.map((c, i) => [c.hash, i] as const));
  const byHash = new Map(commits.map((c) => [c.hash, c] as const));
  // Java LinearGraphParser 会丢弃指向未知节点的边引用
  const parentsOf = new Map(commits.map((c) => [c.hash, c.parents.filter((p) => byHash.has(p))] as const));

  // 1) heads = 未被任何提交列为父提交的提交（Java getHeads：up 边为空的节点）
  const headSet = new Set(commits.map((c) => c.hash));
  for (const c of commits) {
    for (const p of c.parents) headSet.delete(p);
  }
  const sortedHeads = [...headSet].sort();

  // 2) DFS 行走分配 layoutIndex（GraphLayoutBuilder.build 的 walk 语义：单链下行 + 回溯）
  const layoutIndex = new Map<string, number>();
  const importantHeads: string[] = [];
  let currentLayoutIndex = 1;
  const stack: string[] = [];
  for (const head of sortedHeads) {
    if (layoutIndex.has(head)) continue;
    importantHeads.push(head);
    stack.push(head);
    while (stack.length > 0) {
      const node = stack[stack.length - 1];
      const firstVisit = !layoutIndex.has(node);
      if (firstVisit) layoutIndex.set(node, currentLayoutIndex);
      const next = parentsOf.get(node)!.find((p) => !layoutIndex.has(p));
      if (next === undefined) {
        if (firstVisit) currentLayoutIndex++;
        stack.pop();
      } else {
        stack.push(next);
      }
    }
  }

  // 3) 每个节点所属 head（GraphLayoutImpl.getOneOfHeadNodeIndex）
  const layoutIndexForHeads = importantHeads.map((h) => layoutIndex.get(h)!);
  const headOf = new Map<string, string>();
  for (const c of commits) {
    const i = binarySearch(layoutIndexForHeads, layoutIndex.get(c.hash)!);
    const headOrder = i < 0 ? Math.max(0, -i - 2) : i;
    headOf.set(c.hash, importantHeads[headOrder]);
  }

  const laneOf = new Map(commits.map((c) => [c.hash, layoutIndex.get(c.hash)! - 1] as const));

  return commits.map((commit, rowIdx) => {
    const lane = laneOf.get(commit.hash)!;
    const head = headOf.get(commit.hash)!;
    // 完整 Java 着色：主线（layoutIndex == head 的 layoutIndex）染 head 首个 ref 哈希色，
    // fragment 染自身 layoutIndex 色（GraphColorManagerImpl.getColor 实测）
    const isMainLine = layoutIndex.get(commit.hash) === layoutIndex.get(head);
    const color = isMainLine ? colorForRef(byHash.get(head)!.refs[0] ?? '') : colorById(layoutIndex.get(commit.hash)!);
    const edges: EdgeSegment[] = parentsOf.get(commit.hash)!.map((p) => ({
      fromLane: lane,
      toLane: laneOf.get(p)!,
      fromRow: rowIdx,
      toRow: rowOf.get(p)!,
      ...(commit.edgeTypes?.[p] !== undefined ? { type: commit.edgeTypes[p] } : {}),
    }));
    return { commit, lane, edges, color };
  });
}

/**
 * 行内边集（Java EdgesInRowGenerator.getEdgesInRow 语义）：对每个行 i，返回所有
 * 「严格跨过该行」的正常边（upRow < i < downRow）的填充段——长边在中间行的折线/直连段。
 * 特殊边（NOT_LOAD/DOTTED_ARROW_*）被 Java NORMAL_UP/NORMAL_DOWN 过滤器排除，此处等价于
 * 丢弃指向未知行的父引用。段内 type 对应 EdgePrintElementImpl 线型（'U' 实线 / 'D' 虚线）。
 * 排序与 Java GraphStrUtils 一致：up 升序、同 up 按 down 降序。
 */
export function edgesInRow(rows: LayoutRow[]): EdgeSegment[][] {
  const rowOf = new Map(rows.map((r, i) => [r.commit.hash, i] as const));
  const laneOf = new Map(rows.map((r) => [r.commit.hash, r.lane] as const));

  const normalEdges: Array<{ up: number; down: number; type: 'U' | 'D' }> = [];
  for (const row of rows) {
    const up = rowOf.get(row.commit.hash)!;
    const seen = new Set<string>();
    for (const p of row.commit.parents) {
      if (seen.has(p)) continue; // Java Set<GraphEdge> 对相同边去重
      seen.add(p);
      const down = rowOf.get(p);
      if (down === undefined) continue; // NOT_LOAD 等特殊边：目标行不存在
      const type = row.commit.edgeTypes?.[p] ?? 'U';
      // Java createNormalEdge 以 min/max 归一化方向
      normalEdges.push({ up: Math.min(up, down), down: Math.max(up, down), type });
    }
  }

  const result: EdgeSegment[][] = rows.map(() => []);
  for (const e of normalEdges) {
    for (let i = e.up + 1; i < e.down; i++) {
      result[i].push({
        fromRow: e.up,
        toRow: e.down,
        fromLane: laneOf.get(rows[e.up].commit.hash)!,
        toLane: laneOf.get(rows[e.down].commit.hash)!,
        type: e.type,
      });
    }
  }
  // Java GraphElementComparatorByLayoutIndex 实测：up 升序，同 up 按 down 降序
  return result.map((list) => list.sort((a, b) => a.fromRow - b.fromRow || b.toRow - a.toRow));
}

/**
 * 包含分支查询（Java ReachableNodes.getContainingBranches / ContainingBranchesTest）：
 * 对每个节点 n，返回分支行号 b 的升序列表，其中 n 位于 b 的祖先链上（沿父边从 b 可走到 n，
 * 含 b 自身）。越界分支行号（Java 中不匹配任何节点）被忽略。
 */
export function containingBranches(commits: LayoutCommit[], branchRows: number[]): number[][] {
  const rowOf = new Map(commits.map((c, i) => [c.hash, i] as const));
  const parentRows = commits.map((c) => {
    const seen = new Set<string>();
    const rows: number[] = [];
    for (const p of c.parents) {
      const r = rowOf.get(p);
      if (r !== undefined && !seen.has(p)) {
        seen.add(p);
        rows.push(r);
      }
    }
    return rows;
  });

  const result: number[][] = commits.map(() => []);
  for (const b of branchRows) {
    if (b < 0 || b >= commits.length) continue;
    const visited = new Set<number>();
    const stack = [b];
    while (stack.length > 0) {
      const r = stack.pop()!;
      if (visited.has(r)) continue;
      visited.add(r);
      for (const p of parentRows[r]) {
        if (!visited.has(p)) stack.push(p);
      }
    }
    for (const r of visited) result[r].push(b);
  }
  return result.map((list) => list.sort((x, y) => x - y));
}

/** 邻接边（Java GraphEdge 的 TS 对应）：up/down 为行号（null 表示缺失端），target 为 NOT_LOAD 目标 id */
export interface AdjacentEdge {
  up: number | null;
  down: number | null;
  target: number | null;
  type: 'U' | 'N';
}

/**
 * 线性图构建（Java PermanentLinearGraphBuilder / GraphBuilderTest）：
 * 按输入行序输出每行的邻接边，顺序与 Java 存储序一致：
 * 1) up 简单边（上一行是简单节点：唯一父 == 本行）；
 * 2) 本行的 up 边（父列表含本行的非简单行，按行号升序）；
 * 3) 本行的 down 边（父提交按列表序；父行 ≤ 本行或不在图中 → NOT_LOAD，目标 = -parseInt(hash, 16)）；
 * 4) down 简单边（本行是简单节点 → 隐式连下一行）。
 * 父提交先去重（Java DuplicateParentFixer：保留首次出现）。
 */
export function buildLinearGraph(commits: LayoutCommit[]): AdjacentEdge[][] {
  const rowOf = new Map(commits.map((c, i) => [c.hash, i] as const));
  const dedupedParents = commits.map((c) => {
    const seen = new Set<string>();
    const parents: string[] = [];
    for (const p of c.parents) {
      if (!seen.has(p)) {
        seen.add(p);
        parents.push(p);
      }
    }
    return parents;
  });
  const simple = commits.map((c, i) => dedupedParents[i].length === 1 && dedupedParents[i][0] === commits[i + 1]?.hash);

  // up 行集合：父列表含本行 hash 的非简单行（简单行的边隐式，不写入存储）
  const upRows: number[][] = commits.map(() => []);
  for (let r = 0; r < commits.length; r++) {
    if (simple[r]) continue;
    for (const p of dedupedParents[r]) {
      const n = rowOf.get(p);
      if (n !== undefined && n !== r) upRows[n].push(r);
    }
  }

  const result: AdjacentEdge[][] = commits.map(() => []);
  for (let n = 0; n < commits.length; n++) {
    const edges = result[n];
    if (n > 0 && simple[n - 1]) edges.push({ up: n - 1, down: n, target: null, type: 'U' });
    for (const r of upRows[n]) edges.push({ up: r, down: n, target: null, type: 'U' });
    if (!simple[n]) {
      for (const p of dedupedParents[n]) {
        const r = rowOf.get(p);
        // Java 行为：父行 ≤ 本行（占位符不会被修复）或不在图中 → NOT_LOAD 边
        if (r !== undefined && r > n) {
          edges.push({ up: n, down: r, target: null, type: 'U' });
        } else {
          edges.push({ up: n, down: null, target: -parseInt(p, 16), type: 'N' });
        }
      }
    }
    if (simple[n]) edges.push({ up: n, down: n + 1, target: null, type: 'U' });
  }
  return result;
}

/**
 * JDK `Arrays.binarySearch(int[], int)` 的等价实现（对重复值返回搜索路径上命中的下标）。
 * GraphLayoutImpl.getHeadOrder 依赖该查找语义。
 */
function binarySearch(sortedValues: number[], key: number): number {
  let low = 0;
  let high = sortedValues.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midValue = sortedValues[mid];
    if (midValue < key) low = mid + 1;
    else if (midValue > key) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}
