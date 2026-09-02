// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/edgesInRow/manyDownNodes_in.txt + manyDownNodes_out.txt。
// Java 输入：0_U|-1_U 2_U 3_U 4_U    1_U|-    2_U|-    3_U|-    4_U|-
// （单节点扇出 4 条边：验证同 up 下按 down 降序排序与「相邻行边不填充」）

import type { LayoutCommit } from '../../types';

/** 输入：manyDownNodes_in.txt（全部 USUAL 边） */
export const commits: LayoutCommit[] = [
  { hash: '0', parents: ['1', '2', '3', '4'], refs: [] },
  { hash: '1', parents: [], refs: [] },
  { hash: '2', parents: [], refs: [] },
  { hash: '3', parents: [], refs: [] },
  { hash: '4', parents: [], refs: [] },
];

/** 期望输出：manyDownNodes_out.txt（跨行边集合 + down 降序） */
export const expected: string[] = ['none', '0_4_U 0_3_U 0_2_U', '0_4_U 0_3_U', '0_4_U', 'none'];
