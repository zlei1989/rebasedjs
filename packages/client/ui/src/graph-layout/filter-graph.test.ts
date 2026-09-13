// @vitest-environment node
/**
 * 分支过滤纯函数测试（Java 出处：GraphUtil.getReachableMatchingNodes / DottedFilterEdgesGenerator）。
 * 重点覆盖 downWalk（子方向，max 传播）与 upWalk（父方向，min 传播）的对称性。
 */
import { describe, expect, it } from 'vitest';
import type { LayoutRow } from './types';
import { branchAnchors, dottedFilterEdges, reachableRows } from './filter-graph';

function rows(spec: Array<[string, string[], string[]?]>): LayoutRow[] {
  return spec.map(([hash, parents, refs]) => ({
    commit: { hash, parents, refs: refs ?? [] },
    lane: 0,
    edges: [],
    color: '#000000',
  }));
}

// 图：a→b→c→d（主线），x→d（侧支 x 在 d 之上另起一行？不——侧支应是 d 的另一个子）
// 采用：x(0)→d(3) 侧支与 a(0)..? 冲突，故用真实形态：a→b→d，x→d
const graph = rows([
  ['a', ['b']],
  ['x', ['d']],
  ['b', ['d']],
  ['d', []],
]);

describe('branchAnchors', () => {
  it('refs 命中选中分支名的行（剥 HEAD -> 前缀，tag 不算分支）', () => {
    const g = rows([
      ['a', ['d'], ['HEAD -> main', 'tag: v1']],
      ['d', []],
    ]);
    expect(branchAnchors(g, ['main'])).toEqual([0]);
    expect(branchAnchors(g, ['v1'])).toEqual([]);
    expect(branchAnchors(g, ['nope'])).toEqual([]);
  });
});

describe('reachableRows', () => {
  it('从锚点沿父边 DFS（含锚点自身）', () => {
    // 锚点 b(2) → b、d(3)；a(0)/x(1) 不可达
    expect([...reachableRows(graph, [2])].sort()).toEqual([2, 3]);
    // 锚点 a(0) 与 x(1) → 全部
    expect([...reachableRows(graph, [0, 1])].sort()).toEqual([0, 1, 2, 3]);
  });

  it('锚点为空 → 空集（未选任何分支即不过滤，由调用方以 undefined 表示不过滤）', () => {
    expect(reachableRows(graph, []).size).toBe(0);
  });
});

describe('dottedFilterEdges', () => {
  it('隐藏的中间节点两侧各连一条虚线边，且去重', () => {
    // 可见 a(0) 与 d(3)，隐藏 x(1)、b(2)：a—d 双向各加一次 → 去重为一条
    const visible = (r: number): boolean => r === 0 || r === 3;
    expect(dottedFilterEdges(graph, visible)).toEqual([{ up: 0, down: 3 }]);
  });

  it('相邻可见节点之间不产生虚线边', () => {
    const visible = (r: number): boolean => r !== 1; // 隐藏 x，a 与 b 相邻可见
    const edges = dottedFilterEdges(graph, visible);
    expect(edges).toEqual([]);
  });

  it('全可见时无虚线边（恒等）', () => {
    expect(dottedFilterEdges(graph, () => true)).toEqual([]);
  });

  it('链—隐藏—链：跨越多层隐藏节点的两端各连一条', () => {
    // a(0)→b(1)→c(2)→d(3)→e(4)，只保留 a 与 e
    const g = rows([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['d']],
      ['d', ['e']],
      ['e', []],
    ]);
    const visible = (r: number): boolean => r === 0 || r === 4;
    expect(dottedFilterEdges(g, visible)).toEqual([{ up: 0, down: 4 }]);
  });

  it('分叉—隐藏—合流：两个可见子节点各自与自己那条隐藏链的首个可见祖先相连', () => {
    // a(0)→c(2)、b(1)→c(2)、c(2)→d(3)；隐藏 c，保留 a、b、d
    const g = rows([
      ['a', ['c']],
      ['b', ['c']],
      ['c', ['d']],
      ['d', []],
    ]);
    const visible = (r: number): boolean => r !== 2;
    expect(dottedFilterEdges(g, visible)).toEqual([
      { up: 0, down: 3 },
      { up: 1, down: 3 },
    ]);
  });
});
