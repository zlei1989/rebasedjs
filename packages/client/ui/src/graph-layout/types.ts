// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 移植自 platform/vcs-log/graph（impl/permanent/GraphLayoutBuilder.kt、GraphLayoutImpl.kt、
// impl/print/EdgesInRowGenerator.java）。

/** graph-layout 数据模型（Java vcs-log/graph 的 TS 对应物；Apache-2.0，语义源自 JetBrains 实现） */
export interface LayoutCommit {
  hash: string;
  parents: string[];
  refs: string[];
  /**
   * 可选：父哈希 → 边类型（Java GraphEdgeType 子集：'U' = USUAL 实线、'D' = DOTTED 虚线）。
   * 缺省视为 'U'；未知目标的父（NOT_LOAD 等特殊边）不在此记录，由行号过滤丢弃。
   */
  edgeTypes?: Partial<Record<string, 'U' | 'D'>>;
}

/** 行间边段：连接相邻两行的 lane 位置 */
export interface EdgeSegment {
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
  /**
   * 边类型（Java GraphEdgeType 子集），对应 EdgePrintElementImpl.convertToLineStyle：
   * 'U' → SOLID 实线，'D' → DASHED 虚线。缺省 'U'。
   */
  type?: 'U' | 'D';
}

export interface LayoutRow {
  commit: LayoutCommit;
  lane: number;
  edges: EdgeSegment[];
  color: string;
}
