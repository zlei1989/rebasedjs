// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapRowsToVisible } from './rows-mapping';
import type { LayoutRow } from './types';

function row(hash: string): LayoutRow {
  return { commit: { hash, parents: [], refs: [] }, lane: 0, edges: [], color: '#888888' };
}

describe('mapRowsToVisible', () => {
  it('新提交插顶部，旧行下移', () => {
    const visible = mapRowsToVisible([row('c'), row('b'), row('a')], 1);
    // 1 条新提交到达：总行数 4，新行在最前
    expect(visible.offset).toBe(1);
    expect(visible.visible.map((r) => r.commit.hash)).toEqual(['c', 'b', 'a']);
  });

  it('无新提交时偏移为 0', () => {
    const visible = mapRowsToVisible([row('c')], 0);
    expect(visible.offset).toBe(0);
    expect(visible.visible.map((r) => r.commit.hash)).toEqual(['c']);
  });
});
