// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 移植自 platform/vcs-log/graph（impl/permanent/GraphLayoutBuilder.kt、GraphLayoutImpl.kt）。
//
// 语义对照：
// - GraphLayoutBuilder.build：自排序后的 heads 起做 DFS 单链行走（显式栈），为每个节点分配 layoutIndex；
//   走到死胡同且该节点为首次访问时 layoutIndex 递增——「边冲突时开新 lane、合并行收拢」由此而来。
// - GraphLayoutImpl.getOneOfHeadNodeIndex：对 importantHeads 的 layoutIndex 数组做 JDK binarySearch，
//   未命中时取 max(0, -insertionPoint - 2) 得到 head 序号。
// - lane = layoutIndex - 1（0 基列号）；color 按 GraphColorGetterByHead 语义由所属 head 决定，
//   此处以 `c<head 在输入中的行号>` 表示（上层可映射到具体色板）。
// - head 排序按哈希字典序，对应 Java 测试中按提交名比较的 comparator（真实 IntelliJ 用时间戳，可替换）。
// - 偏离 Java branches 参数：带 refs 的提交不参与 head 集合（简报模型中 refs 仅作展示元数据）。

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
    const edges: EdgeSegment[] = parentsOf.get(commit.hash)!.map((p) => ({
      fromLane: lane,
      toLane: laneOf.get(p)!,
      fromRow: rowIdx,
      toRow: rowOf.get(p)!,
    }));
    return { commit, lane, edges, color: `c${rowOf.get(head)}` };
  });
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
