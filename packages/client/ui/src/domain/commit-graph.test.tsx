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

  it('切片画布的边坐标换算到局部坐标系（y 落在画布高度内）', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    // 第 5 行（index 4，侧支 c2b）：切片 rows[3..5]，画布高 3×24=72；
    // 切片内边为 c2(3→5)、c2b(4→5)，局部坐标均应在 [0, 72] 内
    const canvas = within(rows[4]).getByTestId('graph-canvas');
    const height = Number(canvas.getAttribute('height'));
    expect(height).toBe(72);
    const lines = canvas.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const attr of ['y1', 'y2']) {
        const y = Number(line.getAttribute(attr));
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(height);
      }
    }
  });

  it('边端点与本行节点圆点对齐（存在边从本行圆点出发）', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    const canvas = within(rows[4]).getByTestId('graph-canvas');
    // c2b 在切片 rows[3..5] 的局部下标 1（lane 1 → cx=27，cy=36）
    const own = canvas.querySelectorAll('circle')[1];
    const lines = [...canvas.querySelectorAll('line')];
    const startsAtNode = lines.some(
      (l) => l.getAttribute('x1') === own.getAttribute('cx') && l.getAttribute('y1') === own.getAttribute('cy'),
    );
    expect(startsAtNode).toBe(true);
  });
});
