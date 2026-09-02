// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/layoutBuilder/notFullGraph_in.txt + notFullGraph_out.txt。

import type { EdgeSegment, LayoutCommit } from '../../types';

/** 输入：notFullGraph_in.txt（a0/a1 对 a6、a4 对 a5 的引用不在图中，被丢弃） */
export const input: LayoutCommit[] = [
  { hash: 'a0', parents: ['a1', 'a6', 'a3'], refs: [] },
  { hash: 'a1', parents: ['a6'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: [], refs: [] },
  { hash: 'a4', parents: ['a5'], refs: [] },
];

/**
 * 期望快照：Java 期望文件（layoutIndex|-head 行号）为
 * 1|-0, 1|-0, 3|-2, 2|-0, 4|-4 → lane = layoutIndex-1，color = `c<head 行号>`；
 * edges 为按 Java 语义手推的边段（未知父边不产生边段）。
 */
export const expected: { lanes: number[]; colors: string[]; edges: EdgeSegment[][] } = {
  lanes: [0, 0, 2, 1, 3],
  colors: ['c0', 'c0', 'c2', 'c0', 'c4'],
  edges: [
    [
      { fromLane: 0, toLane: 0, fromRow: 0, toRow: 1 },
      { fromLane: 0, toLane: 1, fromRow: 0, toRow: 3 },
    ],
    [],
    [{ fromLane: 2, toLane: 1, fromRow: 2, toRow: 3 }],
    [],
    [],
  ],
};
