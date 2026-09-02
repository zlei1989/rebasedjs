// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/containingBranches/manyNodes_in.txt + manyNodes_out.txt。
// Java 输入：a0|-a1 a6 a3  a1|-a6  a2|-a3  a3|-  a4|-a5  a5|-  a6|-a7  a7|- ；BRANCH NODES: 1 3 7 4

import type { LayoutCommit } from '../../types';

/** 输入：manyNodes_in.txt 提交列表（a1 分支经 a6 到达 a7，a4 分支经 a5） */
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

/** 分支节点行号（BRANCH NODES: 1 3 7 4，即 a1/a3/a7/a4） */
export const branchRows: number[] = [1, 3, 7, 4];

/** 期望输出：manyNodes_out.txt */
export const expected: string[] = ['none', '1', 'none', '3', '4', '4', '1', '1 7'];
