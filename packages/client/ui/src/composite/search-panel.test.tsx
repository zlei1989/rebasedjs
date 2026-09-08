import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BranchRef, SearchResult } from '@rebased/contracts';
import { SearchPanel } from './search-panel';

/** 测试搜索结果工厂：补全 SearchResult 必填字段 */
function makeResult(partial: Partial<SearchResult> & { hash: string }): SearchResult {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: `subject ${partial.hash}`,
    author: `author ${partial.hash}`,
    dateIso: '2026-01-02T03:04:00Z',
    ...partial,
  };
}

/** 测试分支工厂：补全 BranchRef 必填字段 */
function makeBranch(partial: Partial<BranchRef> & { name: string }): BranchRef {
  return {
    remote: false,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    hash: 'abc',
    mergedIntoHead: false,
    lastCommitIso: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('SearchPanel 渲染', () => {
  it('渲染搜索结果列表（短哈希/subject/作者/日期）', () => {
    render(
      <SearchPanel
        onSearch={vi.fn()}
        results={[makeResult({ hash: 'hash-1', subject: 'fix: a' })]}
      />,
    );

    const row = screen.getByTestId('search-result-0');
    expect(row).toHaveTextContent('hash-1');
    expect(row).toHaveTextContent('fix: a');
    expect(row).toHaveTextContent('author hash-1');
    expect(row).toHaveTextContent('2026-01-02 03:04');
  });

  it('searching 时渲染加载态', () => {
    render(<SearchPanel onSearch={vi.fn()} searching />);
    expect(screen.getByTestId('search-loading')).toBeInTheDocument();
  });

  it('error 时渲染错误文案', () => {
    render(<SearchPanel onSearch={vi.fn()} error="搜索失败" results={[]} />);
    expect(screen.getByTestId('search-error')).toHaveTextContent('搜索失败');
  });

  it('无结果时渲染 EmptyState（区分未搜索与搜索无命中）', () => {
    const { rerender } = render(<SearchPanel onSearch={vi.fn()} />);
    expect(screen.getByText('输入关键词开始搜索')).toBeInTheDocument();

    rerender(<SearchPanel onSearch={vi.fn()} results={[]} />);
    expect(screen.getByText('暂无搜索结果')).toBeInTheDocument();
  });
});

describe('SearchPanel 交互', () => {
  it('输入关键词点击搜索以 (q, grep) 调 onSearch', () => {
    const onSearch = vi.fn();
    render(<SearchPanel onSearch={onSearch} />);

    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'fix' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('fix', 'grep');
  });

  it('模式切换为 pickaxe 后搜索载荷携带新模式', () => {
    const onSearch = vi.fn();
    render(<SearchPanel onSearch={onSearch} />);

    fireEvent.click(screen.getByText('内容 pickaxe'));
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'fix' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(onSearch).toHaveBeenCalledWith('fix', 'pickaxe');
  });

  it('点击结果以完整哈希调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    render(
      <SearchPanel
        onSearch={vi.fn()}
        results={[makeResult({ hash: 'fullhash123' })]}
        onSelectCommit={onSelectCommit}
      />,
    );

    fireEvent.click(screen.getByTestId('search-result-0'));

    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash123');
  });
});

describe('SearchPanel 分支快速搜索（Search Everywhere Git tab 语义）', () => {
  const BRANCHES = [makeBranch({ name: 'main', current: true }), makeBranch({ name: 'feature-x' })];

  it('branches + onSelectBranch 同传：渲染卡片与分支行（current 徽标），点击以分支名回调', () => {
    const onSelectBranch = vi.fn();
    render(
      <SearchPanel
        onSearch={vi.fn()}
        branches={BRANCHES}
        onSelectBranch={onSelectBranch}
      />,
    );
    const row = screen.getByTestId('branch-quick-main');
    expect(row).toHaveTextContent('main');
    expect(row).toHaveTextContent('当前');
    fireEvent.click(row);
    expect(onSelectBranch).toHaveBeenCalledTimes(1);
    expect(onSelectBranch).toHaveBeenCalledWith('main');
  });

  it('文本即滤：输入子串只留匹配分支；无匹配显示空态', () => {
    render(<SearchPanel onSearch={vi.fn()} branches={BRANCHES} onSelectBranch={vi.fn()} />);
    fireEvent.change(screen.getByTestId('branch-quick-input'), { target: { value: 'feature' } });
    expect(screen.getByTestId('branch-quick-feature-x')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-quick-main')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('branch-quick-input'), { target: { value: 'zzz' } });
    expect(screen.getByText('无匹配分支')).toBeInTheDocument();
  });

  it('缺省 branches/onSelectBranch：不渲染分支快速搜索卡片（向后兼容）', () => {
    render(<SearchPanel onSearch={vi.fn()} />);
    expect(screen.queryByTestId('branch-quick-input')).not.toBeInTheDocument();
  });
});
