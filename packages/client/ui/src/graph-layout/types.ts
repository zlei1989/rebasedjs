// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 移植自 platform/vcs-log/graph（impl/permanent/GraphLayoutBuilder.kt、GraphLayoutImpl.kt）。

/** graph-layout 数据模型（Java vcs-log/graph 的 TS 对应物；Apache-2.0，语义源自 JetBrains 实现） */
export interface LayoutCommit {
  hash: string;
  parents: string[];
  refs: string[];
}

/** 行间边段：连接相邻两行的 lane 位置 */
export interface EdgeSegment {
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
}

export interface LayoutRow {
  commit: LayoutCommit;
  lane: number;
  edges: EdgeSegment[];
  color: string;
}
