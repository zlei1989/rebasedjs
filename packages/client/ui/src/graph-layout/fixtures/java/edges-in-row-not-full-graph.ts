// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/edgesInRow/notFullGraph_in.txt + notFullGraph_out.txt。
// Java 输入：0_U|-1_D 6_N 3_D    1_U|-6_N    2_U|-3_U    3_U|-    4_U|-5_N
// （D = DOTTED 正常边，N = NOT_LOAD 特殊边 —— 特殊边被 NORMAL 过滤器排除，不出现在输出）

import type { LayoutCommit } from '../../types';

/** 输入：notFullGraph_in.txt（NOT_LOAD 父 '6'/'5' 无行号，由未知目标过滤丢弃） */
export const commits: LayoutCommit[] = [
  { hash: '0', parents: ['1', '6', '3'], refs: [], edgeTypes: { '1': 'D', '3': 'D' } },
  { hash: '1', parents: ['6'], refs: [] },
  { hash: '2', parents: ['3'], refs: [], edgeTypes: { '3': 'U' } },
  { hash: '3', parents: [], refs: [] },
  { hash: '4', parents: ['5'], refs: [] },
];

/** 期望输出：notFullGraph_out.txt（仅 DOTTED 长边 0_3 跨行 1、2；NOT_LOAD 边全部排除） */
export const expected: string[] = ['none', '0_3_D', '0_3_D', 'none', 'none'];
