/** BranchCompareView 测试：双组卡片渲染（分支独有/当前独有）+ 行点击回调 + 退出按钮 + 空态 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@rebased/contracts';
import { BranchCompareView } from './branch-compare-view';

/** 提交工厂：补全 CommitInfo 必填字段 */
function makeCommit(partial: Partial<CommitInfo> & { hash: string }): CommitInfo {
  return {
    shortHash: partial.hash.slice(0, 7),
    parents: [],
    author: '张三',
    authorEmail: 'a@b.c',
    dateIso: '2026-01-01T00:00:00+08:00',
    refs: [],
    message: 'feat: x',
    graph: '*',
    ...partial,
  };
}

describe('BranchCompareView', () => {
  it('渲染双组卡片标题（计数）、hint 与提交行（短哈希/subject/作者/日期）', () => {
    render(
      <BranchCompareView
        branch="feature"
        branchCommits={[makeCommit({ hash: 'a'.repeat(40), message: '分支独有提交' })]}
        currentCommits={[makeCommit({ hash: 'b'.repeat(40), message: '当前独有提交' })]}
      />,
    );
    expect(screen.getByText(/与分支/)).toBeInTheDocument();
    expect(screen.getAllByText(/feature/).length).toBeGreaterThan(0);
    expect(screen.getByText('分支独有（1）')).toBeInTheDocument();
    expect(screen.getByText('当前独有（1）')).toBeInTheDocument();
    expect(screen.getByText('分支独有提交')).toBeInTheDocument();
    expect(screen.getByText('当前独有提交')).toBeInTheDocument();
    // 作者/日期每行渲染一次（两组各一）：断言存在且数量=2
    expect(screen.getAllByText('张三')).toHaveLength(2);
    expect(screen.getAllByText('2026-01-01 00:00')).toHaveLength(2);
  });

  it('行点击：以 hash 调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    const hash = 'c'.repeat(40);
    render(
      <BranchCompareView
        branch="feature"
        branchCommits={[makeCommit({ hash, message: 'x' })]}
        currentCommits={[]}
        onSelectCommit={onSelectCommit}
      />,
    );
    fireEvent.click(screen.getByTestId(`compare-row-分支独有-${hash.slice(0, 7)}`));
    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith(hash);
  });

  it('空组渲染「无提交」', () => {
    render(<BranchCompareView branch="feature" branchCommits={[]} currentCommits={[]} />);
    expect(screen.getAllByText('无提交')).toHaveLength(2);
  });

  it('「退出对比」按钮点击 → onExit', () => {
    const onExit = vi.fn();
    render(
      <BranchCompareView branch="feature" branchCommits={[]} currentCommits={[]} onExit={onExit} />,
    );
    fireEvent.click(screen.getByTestId('compare-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('未传 onExit 时不渲染退出按钮', () => {
    render(<BranchCompareView branch="feature" branchCommits={[]} currentCommits={[]} />);
    expect(screen.queryByTestId('compare-exit')).not.toBeInTheDocument();
  });
});
