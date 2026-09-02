// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/edgesInRow/manyNodes_in.txt + manyNodes_out.txt。
// Java 输入（节点号即行号；'-1_U' 为 NOT_LOAD 特殊边，'6_D' 为 DOTTED 边，其余为 USUAL）：
//   0_U|-1_U 6_U 3_U    1_U|-6_D    2_U|-3_U    3_U|-
//   4_U|-5_U    5_U|-    6_U|-7_U    7_U|-

import type { LayoutCommit } from '../../types';

/**
 * 输入：manyNodes_in.txt。parents 保留全部边（含 NOT_LOAD 的 '-1'）；
 * edgeTypes 仅记录 USUAL/DOTTED（'N' 边由 buildLayout/edgesInRow 的未知目标过滤丢弃）。
 */
export const commits: LayoutCommit[] = [
  { hash: '0', parents: ['-1', '6', '3'], refs: [], edgeTypes: { '6': 'U', '3': 'U' } },
  { hash: '1', parents: ['6'], refs: [], edgeTypes: { '6': 'D' } },
  { hash: '2', parents: ['3'], refs: [], edgeTypes: { '3': 'U' } },
  { hash: '3', parents: [], refs: [] },
  { hash: '4', parents: ['5'], refs: [], edgeTypes: { '5': 'U' } },
  { hash: '5', parents: [], refs: [] },
  { hash: '6', parents: ['7'], refs: [], edgeTypes: { '7': 'U' } },
  { hash: '7', parents: [], refs: [] },
];

/**
 * 期望输出：manyNodes_out.txt（每行：跨行正常边 `upRow_downRow_类型`，空行为 'none'；
 * 排序为 up 升序、同 up 按 down 降序 —— GraphElementComparatorByLayoutIndex 实测）。
 */
export const expected: string[] = [
  'none',
  '0_6_U 0_3_U',
  '0_6_U 0_3_U 1_6_D',
  '0_6_U 1_6_D',
  '0_6_U 1_6_D',
  '0_6_U 1_6_D',
  'none',
  'none',
];
