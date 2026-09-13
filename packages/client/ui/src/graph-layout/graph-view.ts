/**
 * 图视图变换：把「布局结果 + 过滤/折叠状态」变成可直接渲染的行数组。
 *
 * 这是渲染前的**唯一**变换点，职责四项（设计 §3.3）：
 *   ① 算可见性（分支过滤的可达集 / 折叠隐藏的中间行）；
 *   ② 删除隐藏行，并把所有边与端点的行号**重映射**到可见序（不重映射的话
 *      domain/commit-graph-segments 会按错误的行号算几何、画出乱线）；
 *   ③ 裁掉指向隐藏端点的普通边（等价 Java CollapsedGraph.CompiledGraph 中
 *      `compiledNodeIndex` 返回 -1 时丢弃该边）；
 *   ④ 注入虚线边（折叠 / 过滤两种），带 kind 供交互层区分。
 *
 * 车道口径：注入边的 fromLane/toLane 取**两端 delegate 行的 Java 车道**，
 * 故随后的 compactLanes 能把它们与普通边一视同仁地压实（设计 §3.3 压实口径）。
 */

import type { LayoutRow } from './types';
import type { CollapsedFragment, LinearFragment } from './collapse';
import { buildRowIndex, fragmentsToRows } from './collapse';
import { branchAnchors, dottedFilterEdges, reachableRows } from './filter-graph';

export interface GraphView {
  /** 渲染用行（隐藏行已删除、行号已重映射为可见序） */
  rows: LayoutRow[];
  /** 可见的 delegate 行号 */
  visible: Set<number>;
  /** 被隐藏的 delegate 行号 */
  hidden: Set<number>;
  /** 注入的虚线边（可见行号对） */
  dottedEdges: LinearFragment[];
}

/**
 * 应用过滤与折叠。
 * @param rows buildLayout 输出（delegate 行号）
 * @param branches 分支过滤选中的分支名；空 = 不过滤
 * @param collapsed 已折叠的线性链；**过滤激活时忽略**（对齐 Java：FilteredController 下折叠动作不可用）
 */
export function applyGraphView(rows: LayoutRow[], branches: string[], collapsed: CollapsedFragment[]): GraphView {
  const idx = buildRowIndex(rows);
  const filterActive = branches.length > 0;

  // ① 可见性：过滤激活时可达集，否则全可见
  const visible = filterActive ? reachableRows(rows, branchAnchors(rows, branches), idx) : new Set(rows.map((_, i) => i));

  // ② 折叠链 → 行号对（过滤激活时忽略折叠）
  const applied = filterActive ? [] : fragmentsToRows(rows, collapsed, idx);
  const hidden = new Set<number>();
  for (let i = 0; i < rows.length; i++) if (!visible.has(i)) hidden.add(i);
  for (const f of applied) for (let k = f.up + 1; k < f.down; k++) hidden.add(k);

  // ③ 行号重映射
  const keep: number[] = [];
  const remap = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    if (hidden.has(i)) continue;
    remap.set(i, keep.length);
    keep.push(i);
  }

  // ④ 注入的虚线边（可见行号对）
  const dotted: LinearFragment[] = [];
  for (const f of applied) {
    if (hidden.has(f.up) || hidden.has(f.down)) continue;
    dotted.push({ up: remap.get(f.up)!, down: remap.get(f.down)! });
  }
  if (filterActive) {
    for (const e of dottedFilterEdges(rows, (r) => visible.has(r))) {
      if (hidden.has(e.up) || hidden.has(e.down)) continue;
      dotted.push({ up: remap.get(e.up)!, down: remap.get(e.down)! });
    }
  }

  const outRows: LayoutRow[] = keep.map((src) => {
    const row = rows[src];
    const edges = row.edges
      .filter((e) => !hidden.has(e.toRow))
      .map((e) => ({ ...e, fromRow: remap.get(e.fromRow) ?? 0, toRow: remap.get(e.toRow) ?? 0 }));
    return { ...row, edges };
  });

  for (const e of dotted) {
    const upSrc = keep[e.up];
    const downSrc = keep[e.down];
    const kind: 'collapse' | 'filter' = filterActive ? 'filter' : 'collapse';
    outRows[e.up].edges.push({
      fromLane: rows[upSrc].lane,
      toLane: rows[downSrc].lane,
      fromRow: e.up,
      toRow: e.down,
      type: 'D',
      kind,
    });
  }

  return { rows: outRows, visible, hidden, dottedEdges: dotted };
}
