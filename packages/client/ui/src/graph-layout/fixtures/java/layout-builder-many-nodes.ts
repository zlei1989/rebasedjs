// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/layoutBuilder/manyNodes_in.txt + manyNodes_out.txt。

import type { EdgeSegment, LayoutCommit } from '../../types';

/** 输入：manyNodes_in.txt（a0/a2/a4 为三个 head，按哈希字典序 a0 < a2 < a4 行走） */
export const input: LayoutCommit[] = [
  { hash: 'a0', parents: ['a1', 'a6', 'a3'], refs: [] },
  { hash: 'a1', parents: ['a7'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: [], refs: [] },
  { hash: 'a4', parents: ['a5'], refs: [] },
  { hash: 'a5', parents: [], refs: [] },
  { hash: 'a6', parents: ['a7'], refs: [] },
  { hash: 'a7', parents: ['a8'], refs: [] },
  { hash: 'a8', parents: [], refs: [] },
];

/**
 * 期望快照：Java 期望文件（layoutIndex|-head 行号）为
 * 1|-0, 1|-0, 4|-2, 3|-0, 5|-4, 5|-4, 2|-0, 1|-0, 1|-0
 * → lane = layoutIndex-1，color = `c<head 行号>`；edges 为按 Java 语义手推的边段。
 */
export const expected: { lanes: number[]; colors: string[]; edges: EdgeSegment[][] } = {
  lanes: [0, 0, 3, 2, 4, 4, 1, 0, 0],
  colors: ['c0', 'c0', 'c2', 'c0', 'c4', 'c4', 'c0', 'c0', 'c0'],
  edges: [
    [
      { fromLane: 0, toLane: 0, fromRow: 0, toRow: 1 },
      { fromLane: 0, toLane: 1, fromRow: 0, toRow: 6 },
      { fromLane: 0, toLane: 2, fromRow: 0, toRow: 3 },
    ],
    [{ fromLane: 0, toLane: 0, fromRow: 1, toRow: 7 }],
    [{ fromLane: 3, toLane: 2, fromRow: 2, toRow: 3 }],
    [],
    [{ fromLane: 4, toLane: 4, fromRow: 4, toRow: 5 }],
    [],
    [{ fromLane: 1, toLane: 0, fromRow: 6, toRow: 7 }],
    [{ fromLane: 0, toLane: 0, fromRow: 7, toRow: 8 }],
    [],
  ],
};
