// @vitest-environment node
/** applyGraphView：隐藏行删除 + 边裁剪 + 行号重映射 + 虚线注入（设计 §3.3） */
import { describe, expect, it } from 'vitest';
import type { LayoutRow } from './types';
import { applyGraphView } from './graph-view';

function rows(spec: Array<[string, string[]]>): LayoutRow[] {
  return spec.map(([hash, parents], i) => ({
    commit: { hash, parents, refs: [] },
    lane: i,
    // 边的 toRow 必须是**父提交所在行**：这几个用例都是 a→b→c→d 直链，故父行 = i+1
    // （真实数据由 buildLayout 填父行号，commit-graph-segments 也按 toRow 算几何）。
    // 若固定写 0，边就成了指向自己的自环 —— 折叠时「a 指向 b 的边应被裁掉」无从成立。
    edges: parents.map((p) => ({ fromLane: i, toLane: 0, fromRow: i, toRow: i + 1 })),
    color: '#000000',
  }));
}

const chain = rows([
  ['a', ['b']],
  ['b', ['c']],
  ['c', ['d']],
  ['d', []],
]);

describe('applyGraphView', () => {
  it('无状态时恒等（行数与顺序不变，行号不变）', () => {
    const view = applyGraphView(chain, [], []);
    expect(view.rows.map((r) => r.commit.hash)).toEqual(['a', 'b', 'c', 'd']);
    expect(view.rows.every((r, i) => r.edges.every((e) => e.fromRow === i))).toBe(true);
    expect(view.dottedEdges).toEqual([]);
  });

  it('折叠 a..d：中间两行被删除，端点间注入一条 D 虚线，行号重映射到 0/1', () => {
    const view = applyGraphView(chain, [], [{ up: 'a', down: 'd' }]);
    expect(view.rows.map((r) => r.commit.hash)).toEqual(['a', 'd']);
    // a 原本指向 b（已隐藏）的边被裁掉，改为注入的 a→d 虚线
    expect(view.rows[0].edges).toEqual([{ fromLane: 0, toLane: 3, fromRow: 0, toRow: 1, type: 'D', kind: 'collapse' }]);
    expect(view.rows[1].edges).toEqual([]);
    expect(view.dottedEdges).toEqual([{ up: 0, down: 1 }]);
  });

  it('非恒等行号重映射：只折中间一段（{a, c}）时存活边 c→d 指向新的行号', () => {
    const view = applyGraphView(chain, [], [{ up: 'a', down: 'c' }]);
    // 只隐藏 b：存活行 a/c/d 重映射为 0/1/2 —— c、d 的行号都比原值小，故这不是恒等变换
    expect(view.rows.map((r) => r.commit.hash)).toEqual(['a', 'c', 'd']);
    const cRow = view.rows[1]!;
    expect(cRow.commit.hash).toBe('c');
    // c→d 原本是 fromRow 2 / toRow 3，重映射后必须是 1 / 2（若漏了重映射就会留在 2/3）
    expect(cRow.edges).toEqual([{ fromLane: 2, toLane: 0, fromRow: 1, toRow: 2 }]);
    // toRow 指向的行确实还是 d（行号锚定可见序，而不是原 delegate 序）
    expect(view.rows[cRow.edges[0]!.toRow]!.commit.hash).toBe('d');
    // a 指向被隐藏的 b 的边被裁掉，代之以注入的 a→c 折叠虚线（端点车道取 delegate 车道 0 / 2）
    expect(view.rows[0]!.edges).toEqual([{ fromLane: 0, toLane: 2, fromRow: 0, toRow: 1, type: 'D', kind: 'collapse' }]);
    expect(view.dottedEdges).toEqual([{ up: 0, down: 1 }]);
  });

  it('过滤：只保留选中分支可达的行，其余进 hidden（行号重映射）', () => {
    // x(0) 是 side 分支的独有提交；a(1)→b(2)→c(3) 是 main 链。选 main ⇒ 只隐藏 x(0)
    const twoBranch: LayoutRow[] = [
      { commit: { hash: 'x', parents: ['d0'], refs: ['side'] }, lane: 0, edges: [], color: '#000000' },
      { commit: { hash: 'a', parents: ['b'], refs: ['main'] }, lane: 1, edges: [], color: '#000000' },
      { commit: { hash: 'b', parents: ['c'], refs: [] }, lane: 1, edges: [], color: '#000000' },
      { commit: { hash: 'c', parents: [], refs: [] }, lane: 1, edges: [], color: '#000000' },
    ];
    const view = applyGraphView(twoBranch, ['main'], []);
    expect(view.rows.map((r) => r.commit.hash)).toEqual(['a', 'b', 'c']);
    expect(view.hidden.has(0)).toBe(true);
    expect(view.visible.has(0)).toBe(false);
  });

  it('过滤激活时忽略折叠（对齐 Java：FilteredController 下折叠动作不可用）', () => {
    const twoBranch: LayoutRow[] = [
      { commit: { hash: 'x', parents: ['d0'], refs: ['side'] }, lane: 0, edges: [], color: '#000000' },
      { commit: { hash: 'a', parents: ['b'], refs: ['main'] }, lane: 1, edges: [], color: '#000000' },
      { commit: { hash: 'b', parents: ['c'], refs: [] }, lane: 1, edges: [], color: '#000000' },
      { commit: { hash: 'c', parents: [], refs: [] }, lane: 1, edges: [], color: '#000000' },
    ];
    const ignored = applyGraphView(twoBranch, ['main'], [{ up: 'a', down: 'c' }]);
    const none = applyGraphView(twoBranch, ['main'], []);
    // 若折叠未被忽略，rows 会是 ['a','c']；忽略后与无折叠逐字相同
    expect(ignored.rows.map((r) => r.commit.hash)).toEqual(none.rows.map((r) => r.commit.hash));
    expect(ignored.rows.map((r) => r.commit.hash)).toEqual(['a', 'b', 'c']);
    expect(ignored.dottedEdges).toEqual(none.dottedEdges);
  });

  it('空输入安全', () => {
    const view = applyGraphView([], [], []);
    expect(view.rows).toEqual([]);
    expect(view.dottedEdges).toEqual([]);
  });
});
