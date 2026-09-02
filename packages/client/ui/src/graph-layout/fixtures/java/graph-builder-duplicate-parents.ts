// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/graphBuilder/duplicateParents_in.txt + duplicateParents_out.txt。
// Java DuplicateParentFixer 去重（保留首次出现）：0|-1 1 1 3 1 1 → [1, 3]；2|-3 4 4 3 → [3, 4]；3|-4 4 → [4]。
// 节点 3 为简单节点（唯一父 == 下一行 4）→ 边 (3,4) 隐式，出现在行 4 的 up 端。

import type { LayoutCommit } from '../../types';

/** 输入：duplicateParents_in.txt（IntegerTest：id 为十六进制整数串） */
export const input: LayoutCommit[] = [
  { hash: '0', parents: ['1', '1', '1', '3', '1', '1'], refs: [] },
  { hash: '1', parents: ['6'], refs: [] },
  { hash: '2', parents: ['3', '4', '4', '3'], refs: [] },
  { hash: '3', parents: ['4', '4'], refs: [] },
  { hash: '4', parents: ['5', '6'], refs: [] },
  { hash: '5', parents: [], refs: [] },
  { hash: '6', parents: [], refs: [] },
];

/** 期望输出：duplicateParents_out.txt（去重后按父顺序；隐式简单边按 Java 存储序） */
export const expected: string[] = [
  '0_U|-0:1:n_U 0:3:n_U',
  '1_U|-0:1:n_U 1:6:n_U',
  '2_U|-2:3:n_U 2:4:n_U',
  '3_U|-0:3:n_U 2:3:n_U 3:4:n_U',
  '4_U|-3:4:n_U 2:4:n_U 4:5:n_U 4:6:n_U',
  '5_U|-4:5:n_U',
  '6_U|-1:6:n_U 4:6:n_U',
];
