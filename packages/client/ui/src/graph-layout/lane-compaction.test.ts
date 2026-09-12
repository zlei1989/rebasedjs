// @vitest-environment node
/**
 * 显示车道压实的不变量：
 *   ① **稠密仓库是恒等变换**（车道本来就连续、无空洞时，压实不得改动任何一行）；
 *   ② 缩进深度 = 结构深度：同一区间内并存的线连续编号，空列被消除（主仓型场景：至多 2 条线并存 → 最大 1 档）；
 *   ③ 不新增交叉：区间重叠的两条线，显示车道的左右顺序与 Java 车道一致；
 *   ④ 一条线不换列：同一 fragment（Java lane 相同）的所有节点与边端点共用同一个显示车道；
 *   ⑤ 颜色与其他字段原样保留（压实只动车道号，不动 Java 着色语义）。
 */
import { describe, expect, it } from 'vitest';
import { buildLayout } from './build-layout';
import { compactLanes } from './lane-compaction';
import type { LayoutCommit, LayoutRow } from './types';

/**
 * 复刻主仓（rebased-smoke）的形态：主线 + 两条**时间上错开**的侧支。
 * Java DFS 会按发现顺序给侧支发号（S2 → lane 1、S1 → lane 2，因为 S2 先被发现），
 * 于是 S1 落在车道 2、而同时并存的线只有 2 条 —— 压实后应降为 lane 1。
 */
const sparseCommits: LayoutCommit[] = [
  { hash: 'm1', parents: ['p1', 's1'], refs: ['HEAD -> main'] }, // row0：侧支 s1 与之隔 2 行
  { hash: 'p1', parents: ['p2'], refs: [] },
  { hash: 's1', parents: ['p2'], refs: [] }, // row2：与主线汇合，跨度仅 [2,2]
  { hash: 'p2', parents: ['p3'], refs: [] },
  { hash: 'p3', parents: ['p4', 's2'], refs: [] }, // row4：第二条侧支 s2，隔 3 行
  { hash: 'p4', parents: ['p5'], refs: [] },
  { hash: 'p5', parents: ['p6'], refs: [] },
  { hash: 's2', parents: ['p6'], refs: [] }, // row7：跨度 [6,7]
  { hash: 'p6', parents: [], refs: [] },
];

/** 稠密形态（fixtures/merge：m 合并 b 与 a，a 独占 lane 1，无空洞）——压实必须是恒等变换 */
const denseCommits: LayoutCommit[] = [
  { hash: 'm', parents: ['b', 'a'], refs: ['HEAD -> main'] },
  { hash: 'b', parents: ['r'], refs: [] },
  { hash: 'a', parents: ['r'], refs: [] },
  { hash: 'r', parents: [], refs: [] },
];

/** 每行的显示车道是否连续（0..k 无空洞） */
function hasHole(rows: LayoutRow[], index: number): boolean {
  const lanes = new Set<number>([rows[index]!.lane]);
  rows[index]!.edges.forEach((e) => {
    lanes.add(e.fromLane);
    lanes.add(e.toLane);
  });
  const sorted = [...lanes].sort((a, b) => a - b);
  return sorted.some((lane, i) => lane !== i);
}

describe('compactLanes', () => {
  it('稠密车道是恒等变换（逐行逐边与 buildLayout 输出一致）', () => {
    const rows = buildLayout(denseCommits);
    const compacted = compactLanes(rows);
    expect(compacted.map((r) => r.lane)).toEqual(rows.map((r) => r.lane));
    expect(compacted.map((r) => r.edges)).toEqual(rows.map((r) => r.edges));
  });

  it('稀疏车道被压实：Java 车道 2 的侧支降到 1，空列消失（最大缩进 = 并存线数 − 1）', () => {
    const rows = buildLayout(sparseCommits);
    const before = Math.max(...rows.map((r) => r.lane));
    const compacted = compactLanes(rows);
    const after = Math.max(...compacted.map((r) => r.lane));
    // 压前：Java 按发现顺序发号，先被发现的侧支 s2 拿 lane 1、后发现的 s1 拿 lane 2
    expect(before).toBe(2);
    // 该历史任何时刻至多 2 条线并存（s1 跨度 [2,2]、s2 跨度 [6,7]，互不重叠）→ 压后最多 1 档
    expect(after).toBe(1);
    compacted.forEach((_, index) => expect(hasHole(compacted, index)).toBe(false));
    // 两条侧支可以复用同一列（时间上错开），并列在主线右侧
    const s1Lane = compacted[2]!.lane;
    const s2Lane = compacted[7]!.lane;
    expect(s1Lane).toBe(1);
    expect(s2Lane).toBe(1);
  });

  it('不新增交叉：区间重叠的两条线，左右顺序与 Java 车道一致', () => {
    for (const commits of [sparseCommits, denseCommits]) {
      const rows = buildLayout(commits);
      const compacted = compactLanes(rows);
      rows.forEach((row, index) => {
        const lanes = [row.lane, ...row.edges.flatMap((e) => [e.fromLane, e.toLane])];
        const display = [compacted[index]!.lane, ...compacted[index]!.edges.flatMap((e) => [e.fromLane, e.toLane])];
        for (let i = 0; i < lanes.length; i++) {
          for (let j = 0; j < lanes.length; j++) {
            if (lanes[i]! < lanes[j]!) expect(display[i]!).toBeLessThan(display[j]!);
          }
        }
      });
    }
  });

  it('一条线不换列：同一 Java 车道的所有节点与边端点共用同一个显示车道', () => {
    const rows = buildLayout(sparseCommits);
    const compacted = compactLanes(rows);
    const displayOf = new Map<number, number>();
    rows.forEach((row, index) => {
      displayOf.set(row.lane, compacted[index]!.lane);
      row.edges.forEach((edge) => {
        displayOf.set(edge.toLane, compacted[index]!.edges.find((e) => e.toRow === edge.toRow)!.toLane);
      });
    });
    rows.forEach((row, index) => {
      expect(compacted[index]!.lane).toBe(displayOf.get(row.lane));
      compacted[index]!.edges.forEach((edge, ei) => {
        expect(edge.fromLane).toBe(compacted[index]!.lane);
        expect(edge.toLane).toBe(displayOf.get(row.edges[ei]!.toLane));
      });
    });
  });

  it('只动车道号：颜色/父提交/边类型原样保留（Java 着色语义不变）', () => {
    const rows = buildLayout(sparseCommits);
    const compacted = compactLanes(rows);
    expect(compacted.map((r) => r.color)).toEqual(rows.map((r) => r.color));
    expect(compacted.map((r) => r.commit)).toEqual(rows.map((r) => r.commit));
    expect(compacted.map((r) => r.edges.map((e) => [e.type, e.fromRow, e.toRow]))).toEqual(
      rows.map((r) => r.edges.map((e) => [e.type, e.fromRow, e.toRow])),
    );
  });

  it('显示车道只会左移：逐行逐边都不大于 Java 车道（压实不会把图变宽）', () => {
    for (const commits of [sparseCommits, denseCommits]) {
      const rows = buildLayout(commits);
      const compacted = compactLanes(rows);
      rows.forEach((row, index) => {
        expect(compacted[index]!.lane).toBeLessThanOrEqual(row.lane);
        row.edges.forEach((edge, ei) => {
          expect(compacted[index]!.edges[ei]!.toLane).toBeLessThanOrEqual(edge.toLane);
        });
      });
    }
  });
});
