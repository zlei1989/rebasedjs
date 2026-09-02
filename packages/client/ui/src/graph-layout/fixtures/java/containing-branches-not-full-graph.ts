// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/containingBranches/notFullGraph_in.txt + notFullGraph_out.txt。
// Java 输入：a0|-a1 a6 a3  a1|-a6  a2|-a3  a3|-  a4|-a5 ；BRANCH NODES: 0 2 5
// （a6/a5 不在图中；分支行号 5 越界 —— Java 中同样不匹配任何节点）

import type { LayoutCommit } from '../../types';

/** 输入：notFullGraph_in.txt 提交列表 */
export const input: LayoutCommit[] = [
  { hash: 'a0', parents: ['a1', 'a6', 'a3'], refs: [] },
  { hash: 'a1', parents: ['a6'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: [], refs: [] },
  { hash: 'a4', parents: ['a5'], refs: [] },
];

/** 分支节点行号（BRANCH NODES: 0 2 5；5 越界被忽略） */
export const branchRows: number[] = [0, 2, 5];

/** 期望输出：notFullGraph_out.txt */
export const expected: string[] = ['0', '0', '2', '0 2', 'none'];
