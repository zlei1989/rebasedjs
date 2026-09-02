// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/layoutBuilder/oneNode_in.txt + oneNode_out.txt。

import type { EdgeSegment, LayoutCommit } from '../../types';

/** 输入：oneNode_in.txt（单节点，无父提交） */
export const input: LayoutCommit[] = [{ hash: 'a0', parents: [], refs: [] }];

/** 期望快照：Java 期望文件为 `1|-0` → lane = 1-1 = 0，head 行号 0 → color 'c0' */
export const expected: { lanes: number[]; colors: string[]; edges: EdgeSegment[][] } = {
  lanes: [0],
  colors: ['c0'],
  edges: [[]],
};
