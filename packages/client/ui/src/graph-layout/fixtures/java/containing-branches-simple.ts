// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 夹具转制自 platform/vcs-log/graph/testData/containingBranches/simple_in.txt + simple_out.txt。
// Java 输入：a0|-a1  a1|-a2  a2|-a3  a3|- ；BRANCH NODES: 0 2 3

import type { LayoutCommit } from '../../types';

/** 输入：simple_in.txt 提交列表 */
export const input: LayoutCommit[] = [
  { hash: 'a0', parents: ['a1'], refs: [] },
  { hash: 'a1', parents: ['a2'], refs: [] },
  { hash: 'a2', parents: ['a3'], refs: [] },
  { hash: 'a3', parents: [], refs: [] },
];

/** 分支节点行号（BRANCH NODES: 0 2 3） */
export const branchRows: number[] = [0, 2, 3];

/** 期望输出：simple_out.txt（每行：按行号升序的分支列表，空为 'none'） */
export const expected: string[] = ['0', '0', '0 2', '0 2 3'];
