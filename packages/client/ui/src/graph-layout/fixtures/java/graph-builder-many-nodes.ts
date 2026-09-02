// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/graphBuilder/manyNodes_in.txt + manyNodes_out.txt。
// Java GraphBuilderTest 用 PermanentLinearGraphBuilder 归一化：父提交去重、
// 简单节点（唯一父 == 下一行）隐式边、NOT_LOAD 目标 = -Integer.parseInt(hash, 16)。

import type { LayoutCommit } from '../../types';

/** 输入：manyNodes_in.txt 提交列表（a2/a4/a6 为简单节点） */
export const input: LayoutCommit[] = [
  { hash: 'a0', parents: ['a1', 'a6', 'a3'], refs: [] },
  { hash: 'a1', parents: ['a6'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: [], refs: [] },
  { hash: 'a4', parents: ['a5'], refs: [] },
  { hash: 'a5', parents: [], refs: [] },
  { hash: 'a6', parents: ['a7'], refs: [] },
  { hash: 'a7', parents: [], refs: [] },
];

/** 期望输出：manyNodes_out.txt（每行 `行号_U|-` + 邻接边 `up:down:target_类型`；'n' 为 null） */
export const expected: string[] = [
  '0_U|-0:1:n_U 0:6:n_U 0:3:n_U',
  '1_U|-0:1:n_U 1:6:n_U',
  '2_U|-2:3:n_U',
  '3_U|-2:3:n_U 0:3:n_U',
  '4_U|-4:5:n_U',
  '5_U|-4:5:n_U',
  '6_U|-0:6:n_U 1:6:n_U 6:7:n_U',
  '7_U|-6:7:n_U',
];
