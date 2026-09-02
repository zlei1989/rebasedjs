// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/layoutBuilder/oneNodeNotFullGraph_in.txt + oneNodeNotFullGraph_out.txt。

import type { EdgeSegment, LayoutCommit } from '../../types';

/** 输入：oneNodeNotFullGraph_in.txt（父提交 a1/a3/a5 均不在图中，被丢弃 → 与 oneNode 等价） */
export const input: LayoutCommit[] = [{ hash: 'a0', parents: ['a1', 'a3', 'a5'], refs: [] }];

/** 期望快照：Java 期望文件为 `1|-0` → lane = 0，head 行号 0 → color 'c0'；未知父边的边段不产生 */
export const expected: { lanes: number[]; colors: string[]; edges: EdgeSegment[][] } = {
  lanes: [0],
  colors: ['c0'],
  edges: [[]],
};
