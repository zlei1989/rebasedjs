// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/layoutBuilder/headsOrder_in.txt + headsOrder_out.txt。

import type { EdgeSegment, LayoutCommit } from '../../types';

/** 输入：headsOrder_in.txt（head 为 a2 与 ff；按哈希字典序 a2 < ff，故 a2 先行走） */
export const input: LayoutCommit[] = [
  { hash: 'ff', parents: ['a1', 'a3'], refs: [] },
  { hash: 'a1', parents: ['a4'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: ['a4'], refs: [] },
  { hash: 'a4', parents: [], refs: [] },
];

/**
 * 期望快照：Java 期望文件（layoutIndex|-head 行号）为
 * 2|-0, 2|-0, 1|-2, 1|-2, 1|-2
 * → lane = layoutIndex-1，color = `c<head 行号>`；edges 为按 Java 语义手推的边段。
 */
export const expected: { lanes: number[]; colors: string[]; edges: EdgeSegment[][] } = {
  lanes: [1, 1, 0, 0, 0],
  colors: ['c0', 'c0', 'c2', 'c2', 'c2'],
  edges: [
    [
      { fromLane: 1, toLane: 1, fromRow: 0, toRow: 1 },
      { fromLane: 1, toLane: 0, fromRow: 0, toRow: 3 },
    ],
    [{ fromLane: 1, toLane: 0, fromRow: 1, toRow: 4 }],
    [{ fromLane: 0, toLane: 0, fromRow: 2, toRow: 3 }],
    [{ fromLane: 0, toLane: 0, fromRow: 3, toRow: 4 }],
    [],
  ],
};
