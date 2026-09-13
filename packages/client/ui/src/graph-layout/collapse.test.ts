// @vitest-environment node
/**
 * 线性折叠纯函数测试（Java 出处：LinearFragmentGenerator / CollapsedActionManager）。
 * 行序口径：行号 0 = 最新，父提交在更大行号（与 domain/commit-graph 的输入一致）。
 */
import { describe, expect, it } from 'vitest';
import type { LayoutCommit, LayoutRow } from './types';
import { collapseAllFragments, fragmentForEdge, fragmentsToRows, linearFragmentAt } from './collapse';

function row(hash: string, parents: string[], refs: string[] = []): LayoutRow {
  const commit: LayoutCommit = { hash, parents, refs };
  return { commit, lane: 0, edges: parents.map((p) => ({ fromLane: 0, toLane: 0, fromRow: 0, toRow: 0 })), color: '#000000' };
}

/** a→b→c→d→e 单链（全无 refs） */
const chain: LayoutRow[] = [
  row('a', ['b']),
  row('b', ['c']),
  row('c', ['d']),
  row('d', ['e']),
  row('e', []),
];

/** 同一条链，但 b 带 refs（pinned）：pinned 行可做链端点、不可落在链中间 */
const withRef: LayoutRow[] = [chain[0], row('b', ['c'], ['main']), chain[2], chain[3], chain[4]];

describe('linearFragmentAt', () => {
  it('单链中任意一行都折叠成同一条极大链（a..e）', () => {
    expect(linearFragmentAt(chain, 0)).toEqual({ up: 'a', down: 'e' });
    expect(linearFragmentAt(chain, 2)).toEqual({ up: 'a', down: 'e' });
    expect(linearFragmentAt(chain, 4)).toEqual({ up: 'a', down: 'e' });
  });

  it('有 refs 的行不能落在链的中间（对齐 branchNodeIds 不可入 middle），但可以做端点', () => {
    // 锚点在 a：向下走一节到 b，再往下要求「离开 b」——b 是 pinned 故停。链只有 a..b 两行 → null
    expect(linearFragmentAt(withRef, 0)).toBeNull();
    // 锚点在 c：向上走一节到 b（pinned 可做端点），不能再离开 b → up=b；向下走到 e → 链为 b..e
    expect(linearFragmentAt(withRef, 2)).toEqual({ up: 'b', down: 'e' });
  });

  it('pinned 行作锚点：起点片段已含向下一节，故其后整条链都能折叠', () => {
    // 口径③：getRelativeFragment 先取 getDownFragment(锚点) 得 (start, start+1)，扩展才在此之上进行。
    // 若 down 也从 start 起算，pinned 锚点会在第一步就停 ⇒ 返回 null（本用例即锁住该差异）。
    expect(linearFragmentAt(withRef, 1)).toEqual({ up: 'b', down: 'e' });
  });

  it('分叉点截断链（父唯一但子不唯一）', () => {
    const forked: LayoutRow[] = [row('a', ['c']), row('b', ['c']), row('c', ['d']), row('d', [])];
    // a 的父是 c 而不是下一行 b → a 处无链节，且 a 无子可上溯 → null
    expect(linearFragmentAt(forked, 0)).toBeNull();
    // c 有两个子（a、b）→ c 处无链节；上溯到唯一子？c 无子 → null
    expect(linearFragmentAt(forked, 2)).toBeNull();
  });

  it('合并点截断链（子唯一但父不唯一）', () => {
    const merged: LayoutRow[] = [row('a', ['b', 'x']), row('b', ['c']), row('c', ['d']), row('d', [])];
    // b 向上：a 有两个父（b、x）→ a 与 b 之间不构成链节 → up=b；向下到 d → b..d
    expect(linearFragmentAt(merged, 1)).toEqual({ up: 'b', down: 'd' });
    // a 有两个父 → a 处无链节，且 a 无子 → null
    expect(linearFragmentAt(merged, 0)).toBeNull();
  });

  it('链长不足（无可隐藏中间节点）返回 null', () => {
    const two: LayoutRow[] = [row('a', ['b']), row('b', [])];
    expect(linearFragmentAt(two, 0)).toBeNull();
    expect(linearFragmentAt(two, 1)).toBeNull();
  });

  it('行号越界返回 null', () => {
    expect(linearFragmentAt(chain, -1)).toBeNull();
    expect(linearFragmentAt(chain, 99)).toBeNull();
  });
});

describe('fragmentForEdge', () => {
  it('按边的两端行号取所在链（对齐 getRelativeFragment 从边上取片段）', () => {
    expect(fragmentForEdge(chain, 0, 1)).toEqual({ up: 'a', down: 'e' });
    expect(fragmentForEdge(chain, 2, 3)).toEqual({ up: 'a', down: 'e' });
  });
});

describe('collapseAllFragments', () => {
  it('只向下扩展（对齐 COLLAPSE_ALL 的 getLongDownFragment），逐条极大链、跳过已隐藏行', () => {
    expect(collapseAllFragments(chain)).toEqual([{ up: 'a', down: 'e' }]);
  });

  it('pinned 行断开成两条链，且已隐藏的行不重复产出', () => {
    // i=a：走一节到 b，离开 b 时 b 是 pinned → 停 → a..b 两行不成链；
    // i=b：走一节到 c，离开 c 与 d 都放行 → b..e 成链并隐藏 c、d；
    // i=c/d 已隐藏被跳过；i=e 无向下链节。
    expect(collapseAllFragments(withRef)).toEqual([{ up: 'b', down: 'e' }]);
  });

  it('互不相连的两条链各产出一条', () => {
    const twoChains: LayoutRow[] = [
      row('a', ['b']),
      row('b', ['c']),
      row('c', ['d']),
      row('d', []),
      row('x', ['y']),
      row('y', ['z']),
      row('z', []),
    ];
    expect(collapseAllFragments(twoChains)).toEqual([
      { up: 'a', down: 'd' },
      { up: 'x', down: 'z' },
    ]);
  });

  it('两行链不产出（无中间节点可隐藏）', () => {
    const two: LayoutRow[] = [row('a', ['b']), row('b', [])];
    expect(collapseAllFragments(two)).toEqual([]);
  });
});

describe('fragmentsToRows', () => {
  it('hash 对 → 行号对；端点不存在的链被丢弃（数据变化后自我保护）', () => {
    expect(fragmentsToRows(chain, [{ up: 'a', down: 'e' }])).toEqual([{ up: 0, down: 4 }]);
    expect(fragmentsToRows(chain, [{ up: 'a', down: 'zz' }])).toEqual([]);
  });

  it('行号随新提交插顶部而偏移，hash 对仍指向正确区间', () => {
    const shifted = [row('new', ['a']), ...chain];
    expect(fragmentsToRows(shifted, [{ up: 'a', down: 'e' }])).toEqual([{ up: 1, down: 5 }]);
  });
});
