// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 移植自 platform/vcs-log/graph impl/facade/RowsMapping.kt（行号 → 提交的映射，新提交插顶部）。
//
// 语义对照：
// - Java RowsMapping 维护「可见行号 → 提交」的双向映射，新提交到达时插入列表头部，
//   旧行行号整体 +n（n 为新提交数）。
// - 本函数提供行偏移对齐契约：visible 为旧行（内容不变），offset 为旧行新行号 = 原行号 + offset。
//   首跑简化：调用方对新提交重算 buildLayout 全量，本函数只负责行号对齐。

import type { LayoutRow } from './types';

export interface VisibleRows {
  /** 旧可见行（保持原顺序；新提交行由调用方在顶部渲染） */
  visible: LayoutRow[];
  /** 行偏移：旧行的新行号 = 原行号 + offset（= 新提交条数） */
  offset: number;
}

/** 新提交插顶部、旧行下移的行号对齐（appendedNewCount = 顶部新插入的行数） */
export function mapRowsToVisible(rows: LayoutRow[], appendedNewCount: number): VisibleRows {
  return { visible: rows, offset: appendedNewCount };
}
