import { describe, expect, it } from 'vitest';
import { buildLayout, buildLinearGraph, containingBranches, edgesInRow } from './build-layout';
import { linearCommits } from './fixtures/linear';
import { mergeCommits } from './fixtures/merge';
import * as headsOrder from './fixtures/java/layout-builder-heads-order';
import * as manyNodes from './fixtures/java/layout-builder-many-nodes';
import * as notFullGraph from './fixtures/java/layout-builder-not-full-graph';
import * as oneNode from './fixtures/java/layout-builder-one-node';
import * as oneNodeNotFullGraph from './fixtures/java/layout-builder-one-node-not-full-graph';
import * as edgesInRowManyNodes from './fixtures/java/edges-in-row-many-nodes';
import * as edgesInRowNotFullGraph from './fixtures/java/edges-in-row-not-full-graph';
import * as edgesInRowManyDownNodes from './fixtures/java/edges-in-row-many-down-nodes';
import * as cbSimple from './fixtures/java/containing-branches-simple';
import * as cbManyNodes from './fixtures/java/containing-branches-many-nodes';
import * as cbNotFullGraph from './fixtures/java/containing-branches-not-full-graph';
import * as gbManyNodes from './fixtures/java/graph-builder-many-nodes';
import * as gbNotFullGraph from './fixtures/java/graph-builder-not-full-graph';
import * as gbDuplicateParents from './fixtures/java/graph-builder-duplicate-parents';
import type { AdjacentEdge } from './build-layout';

describe('buildLayout', () => {
  it('线性链：全部 lane 0，无跨 lane 边', () => {
    const rows = buildLayout(linearCommits);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.edges.every((e) => e.fromLane === 0 && e.toLane === 0))).toBe(true);
  });

  it('合并：分支各自 lane，合并行收拢且边覆盖两 lane', () => {
    const rows = buildLayout(mergeCommits);
    // m 行 lane 0；b 与 a 占 0/1 两个 lane；r 收拢回 lane 0
    // （简报原断言 toEqual([0, 1]) 与 3 行结果长度不符，不可满足；修正为 [0, 0, 1]）
    expect(rows[0].lane).toBe(0);
    const lanes = rows.slice(1).map((r) => r.lane).sort();
    expect(lanes).toEqual([0, 0, 1]);
    expect(rows[0].edges.some((e) => e.toLane === 1)).toBe(true);
  });

  it('color：主线染 head 首个 ref 哈希色，fragment 染自身 layoutIndex 色', () => {
    const rows = buildLayout(mergeCommits);
    expect(rows.every((r) => r.color.length > 0)).toBe(true);
    // m 是唯一 head：m/b/r 为主线（layoutIndex == head 的 layoutIndex），a 为 fragment（layoutIndex 2）
    // Java 实测：colorForRef('HEAD -> main') = #6398a6；colorById(2) = #7663a6
    expect(rows[0].color).toBe('#6398a6');
    expect(rows[1].color).toBe('#6398a6');
    expect(rows[2].color).toBe('#7663a6');
    expect(rows[3].color).toBe('#6398a6');
    expect(rows[2].color).not.toBe(rows[0].color);
  });

  it('merge 展开行：长边经中间行填充，折线跨 lane', () => {
    const rows = buildLayout(mergeCommits);
    const perRow = edgesInRow(rows);
    // m→a 的边跨行 1（0 < 1 < 2）被填充；m→b、a→r 为相邻行边不填充；b→r 跨行 2
    expect(perRow.map((es) => es.map((e) => `${e.fromRow}->${e.toRow}`))).toEqual([[], ['0->2'], ['1->3'], []]);
    // 展开行 1 的填充段：从 lane 0（m）折向 lane 1（a）——折线形状信息
    expect(perRow[1][0]).toEqual({ fromRow: 0, toRow: 2, fromLane: 0, toLane: 1, type: 'U' });
  });
});

describe('Java testData 转制夹具（layoutBuilder）', () => {
  const cases = [
    { name: 'oneNode', ...oneNode },
    { name: 'oneNodeNotFullGraph', ...oneNodeNotFullGraph },
    { name: 'notFullGraph', ...notFullGraph },
    { name: 'manyNodes', ...manyNodes },
    { name: 'headsOrder', ...headsOrder },
  ];

  for (const { name, input, expected } of cases) {
    it(`${name}：lane/color/边快照与 Java 期望文件一致`, () => {
      const rows = buildLayout(input);
      expect(rows.map((r) => r.lane)).toEqual(expected.lanes);
      expect(rows.map((r) => r.color)).toEqual(expected.colors);
      expect(rows.map((r) => r.edges)).toEqual(expected.edges);
    });
  }
});

describe('Java testData 转制夹具（edgesInRow）', () => {
  const cases = [
    { name: 'manyNodes', ...edgesInRowManyNodes },
    { name: 'notFullGraph', ...edgesInRowNotFullGraph },
    { name: 'manyDownNodes', ...edgesInRowManyDownNodes },
  ];

  for (const { name, commits, expected } of cases) {
    it(`${name}：跨行边集合与 Java 期望一致`, () => {
      const rows = buildLayout(commits);
      const actual = edgesInRow(rows).map(
        (row) => row.map((e) => `${e.fromRow}_${e.toRow}_${e.type ?? 'U'}`).join(' ') || 'none',
      );
      expect(actual).toEqual(expected);
    });
  }
});

describe('Java testData 转制夹具（containingBranches）', () => {
  const cases = [
    { name: 'simple', ...cbSimple },
    { name: 'manyNodes', ...cbManyNodes },
    { name: 'notFullGraph', ...cbNotFullGraph },
  ];

  for (const { name, input, branchRows, expected } of cases) {
    it(`${name}：包含分支集合与 Java 期望一致`, () => {
      const actual = containingBranches(input, branchRows).map((list) => list.join(' ') || 'none');
      expect(actual).toEqual(expected);
    });
  }
});

describe('Java testData 转制夹具（graphBuilder）', () => {
  const cases = [
    { name: 'manyNodes', ...gbManyNodes },
    { name: 'notFullGraph', ...gbNotFullGraph },
    { name: 'duplicateParents', ...gbDuplicateParents },
  ];

  const formatEdge = (e: AdjacentEdge) => `${e.up ?? 'n'}:${e.down ?? 'n'}:${e.target ?? 'n'}_${e.type}`;

  for (const { name, input, expected } of cases) {
    it(`${name}：邻接边（去重/简单边/NOT_LOAD）与 Java 期望一致`, () => {
      const actual = buildLinearGraph(input).map((row, i) => `${i}_U|-${row.map(formatEdge).join(' ')}`);
      expect(actual).toEqual(expected);
    });
  }
});
