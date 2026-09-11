import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@rebased/contracts';
import { CommitGraph } from './commit-graph';
import { colorForRef } from '../graph-layout/color';

/** 测试提交工厂：补全 CommitInfo 必填字段，按需覆盖 */
function makeCommit(overrides: Partial<CommitInfo> & { hash: string }): CommitInfo {
  return {
    shortHash: overrides.hash.slice(0, 7),
    parents: [],
    author: 'Alice',
    authorEmail: 'alice@example.com',
    dateIso: '2026-09-01T14:30:00+08:00',
    refs: [],
    message: '提交说明',
    graph: '',
    ...overrides,
  };
}

/** 3 提交（含 merge）：c3 合并 c2 与 c1 */
const commits: CommitInfo[] = [
  makeCommit({ hash: 'c3merge0000001', parents: ['c2', 'c1'], message: '合并 feature 分支' }),
  makeCommit({ hash: 'c2', parents: ['c1'], message: '第二笔提交' }),
  makeCommit({ hash: 'c1', parents: [], message: '初始提交' }),
];

describe('CommitGraph', () => {
  it('按提交数渲染行（3 提交含 merge → 3 行）', () => {
    render(<CommitGraph commits={commits} />);
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(3);
    expect(screen.getByText('合并 feature 分支')).toBeInTheDocument();
    expect(screen.getByText('第二笔提交')).toBeInTheDocument();
    expect(screen.getByText('初始提交')).toBeInTheDocument();
  });

  it('点击行触发 onSelect(hash)', () => {
    const onSelect = vi.fn();
    render(<CommitGraph commits={commits} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('第二笔提交'));
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('行默认列含 Author 与格式化日期', () => {
    render(<CommitGraph commits={commits} />);
    expect(screen.getAllByText('Alice')).toHaveLength(3);
    expect(screen.getAllByText('2026-09-01 14:30')).toHaveLength(3);
  });

  it('分支 chips 默认开、tag chips 默认关；showTags 后显示标签', () => {
    const withRefs: CommitInfo[] = [
      makeCommit({ hash: 'r1', refs: ['main', 'tag: v1.0'], message: '带引用' }),
    ];
    const { rerender } = render(<CommitGraph commits={withRefs} />);
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.queryByText('v1.0')).not.toBeInTheDocument();
    rerender(<CommitGraph commits={withRefs} showTags />);
    expect(screen.getByText('v1.0')).toBeInTheDocument();
  });

  // 冒烟 F-010：分支 chip 底色 = colorForRef(分支名)（与图车道同源、按名稳定），tag chip 不参与
  it('分支 chip 底色取 ref 名 hash 色板，同名稳定异名相异', () => {
    const withRefs: CommitInfo[] = [
      makeCommit({ hash: 'r1', refs: ['main', 'feature'], message: '双分支' }),
    ];
    render(<CommitGraph commits={withRefs} />);
    expect(screen.getByTestId('ref-chip-main')).toHaveStyle({ backgroundColor: colorForRef('main') });
    expect(screen.getByTestId('ref-chip-feature')).toHaveStyle({ backgroundColor: colorForRef('feature') });
    expect(colorForRef('main')).not.toBe(colorForRef('feature'));
  });

  it('空提交列表不渲染行', () => {
    render(<CommitGraph commits={[]} />);
    expect(screen.queryAllByTestId('commit-graph-row')).toHaveLength(0);
  });

  // 冒烟 F-021：?select=<hash> 深链与点击选中均需行级选中态（否则「选中哪一行」无从辨认）
  it('selectedHash 命中的行带选中底色，其余行无底色', () => {
    render(<CommitGraph commits={commits} selectedHash="c2" />);
    const rows = screen.getAllByTestId('commit-graph-row');
    const c2 = rows.find((r) => r.textContent?.includes('第二笔提交'));
    const c1 = rows.find((r) => r.textContent?.includes('初始提交'));
    expect(c2).toHaveAttribute('data-selected', 'true');
    expect(c1).not.toHaveAttribute('data-selected');
    expect(c1).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0)' });
  });

  /** ≥5 行分支合并图：c5 合并主线 c4 与侧支 c2b（含 c5→c2 跨行长边），c2b 落第二 lane */
  const mergeCommits: CommitInfo[] = [
    makeCommit({ hash: 'c5', parents: ['c4', 'c2b'], message: '合并侧支' }),
    makeCommit({ hash: 'c4', parents: ['c3'] }),
    makeCommit({ hash: 'c3', parents: ['c2'] }),
    makeCommit({ hash: 'c2', parents: ['c1'] }),
    makeCommit({ hash: 'c2b', parents: ['c1'], message: '侧支提交' }),
    makeCommit({ hash: 'c1', parents: [] }),
  ];

  it('每行渲染一个「整图视口」：viewBox 覆盖本行那条带，线段按全局坐标画', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    // 第 5 行（index 4）：viewBox 的 y 必须正好是 [4*24, 5*24)，与行盒 1:1 对齐
    const lane = within(rows[4]).getByTestId('commit-graph-lane');
    const svg = lane.querySelector('svg')!;
    const [, minY, , vbH] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(minY).toBe(4 * 24);
    expect(vbH).toBe(24);
    // 线段按全局坐标画：所有 y 必须落在全局 [0, 行数*24] 内，且至少有一条线
    const shapes = [...svg.querySelectorAll('line, polyline')];
    expect(shapes.length).toBeGreaterThan(0);
    const ys = shapes.flatMap((s) =>
      s.tagName === 'line'
        ? [Number(s.getAttribute('y1')), Number(s.getAttribute('y2'))]
        : (s.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[1])),
    );
    for (const y of ys) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(mergeCommits.length * 24);
    }
  });

  it('本行圆点画在本行中线，且该行线段的端点落在 lane 中心（竖线/斜线都接在竖线上）', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    // 第 5 行（index 4，侧支 c2b）：本行圆点 = 该行 SVG 里 cy = 4*24 + 12 的那个
    const svg = within(rows[4]).getByTestId('commit-graph-lane').querySelector('svg')!;
    const own = [...svg.querySelectorAll('circle')].find((c) => Number(c.getAttribute('cy')) === 4 * 24 + 12);
    expect(own).toBeTruthy();
    // lane 中心 x = (lane + 0.5) * 18；本行 c2b 的 lane 由布局给出，这里用圆点自身反查
    const ownX = Number(own!.getAttribute('cx'));
    expect((ownX - 9) % 18).toBe(0);
    // 存在一条线段从本行圆点出发（说明边接在圆点上、不是悬空的斜线）
    const shapes = [...svg.querySelectorAll('line, polyline')];
    const startsAtNode = shapes.some((s) => {
      if (s.tagName === 'line') {
        return Number(s.getAttribute('x1')) === ownX && Number(s.getAttribute('y1')) === 4 * 24 + 12;
      }
      const [x, y] = (s.getAttribute('points') ?? '').split(' ')[0].split(',').map(Number);
      return x === ownX && y === 4 * 24 + 12;
    });
    expect(startsAtNode).toBe(true);
  });
});
