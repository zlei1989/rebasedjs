import { describe, expect, it } from 'vitest';
import { buildLayout } from './build-layout';
import { linearCommits } from './fixtures/linear';
import { mergeCommits } from './fixtures/merge';
import * as headsOrder from './fixtures/java/layout-builder-heads-order';
import * as manyNodes from './fixtures/java/layout-builder-many-nodes';
import * as notFullGraph from './fixtures/java/layout-builder-not-full-graph';
import * as oneNode from './fixtures/java/layout-builder-one-node';
import * as oneNodeNotFullGraph from './fixtures/java/layout-builder-one-node-not-full-graph';

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
