// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/layoutBuilder/oneNode_in.txt + oneNode_out.txt。

import type { EdgeSegment, LayoutCommit } from '../../types';

/** 输入：oneNode_in.txt（单节点，无父提交） */
export const input: LayoutCommit[] = [{ hash: 'a0', parents: [], refs: [] }];

/**
 * 期望快照：Java 期望文件为 `1|-0` → lane = 1-1 = 0。
 * color（Task 6 完整着色）：唯一节点为主线（layoutIndex == head 的 layoutIndex），
 * head 无 ref → colorForRef('') = 默认黑 '#000000'。
 */
export const expected: { lanes: number[]; colors: string[]; edges: EdgeSegment[][] } = {
  lanes: [0],
  colors: ['#000000'],
  edges: [[]],
};
