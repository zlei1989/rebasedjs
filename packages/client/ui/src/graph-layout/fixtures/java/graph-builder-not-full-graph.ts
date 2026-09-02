// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/graphBuilder/notFullGraph_in.txt + notFullGraph_out.txt。
// 不在图中的父提交（a6/a5）→ NOT_LOAD 边，目标 = -parseInt('a6',16) = -166、-parseInt('a5',16) = -165。

import type { LayoutCommit } from '../../types';

/** 输入：notFullGraph_in.txt 提交列表（a6、a5 不在图中） */
export const input: LayoutCommit[] = [
  { hash: 'a0', parents: ['a1', 'a6', 'a3'], refs: [] },
  { hash: 'a1', parents: ['a6'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: [], refs: [] },
  { hash: 'a4', parents: ['a5'], refs: [] },
];

/** 期望输出：notFullGraph_out.txt（NOT_LOAD 边 `up:n:target_N`） */
export const expected: string[] = [
  '0_U|-0:1:n_U 0:n:-166_N 0:3:n_U',
  '1_U|-0:1:n_U 1:n:-166_N',
  '2_U|-2:3:n_U',
  '3_U|-2:3:n_U 0:3:n_U',
  '4_U|-4:n:-165_N',
];
