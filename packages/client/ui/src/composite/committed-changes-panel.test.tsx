import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommittedEntry, CommittedPage } from '@rebased/contracts';
import { CommittedChangesPanel } from './committed-changes-panel';

/** 测试提交条目工厂：补全 CommittedEntry 必填字段 */
function makeEntry(partial: Partial<CommittedEntry> & { hash: string }): CommittedEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: `subject ${partial.hash}`,
    author: `author ${partial.hash}`,
    dateIso: '2026-01-02T03:04:00Z',
    files: [],
    ...partial,
  };
}

/** 测试分页视图工厂：entries + hasMore 组装 CommittedPage */
function makePage(entries: CommittedEntry[], hasMore = false): CommittedPage {
  return { entries, hasMore };
}

describe('CommittedChangesPanel 提交列表', () => {
  it('渲染每个提交的短哈希/subject/作者/日期', () => {
    const page = makePage([
      makeEntry({ hash: 'hash-1', subject: 'fix: a' }),
      makeEntry({ hash: 'hash-2', subject: 'feat: b' }),
    ]);
    render(<CommittedChangesPanel page={page} />);

    const row1 = screen.getByTestId('committed-entry-0');
    expect(row1).toHaveTextContent('hash-1');
    expect(row1).toHaveTextContent('fix: a');
    expect(row1).toHaveTextContent('author hash-1');
    expect(row1).toHaveTextContent('2026-01-02 03:04');

    const row2 = screen.getByTestId('committed-entry-1');
    expect(row2).toHaveTextContent('feat: b');
    expect(row2).toHaveTextContent('author hash-2');
  });

  it('未注入 page 或空提交列表时渲染 EmptyState', () => {
    const { rerender } = render(<CommittedChangesPanel />);
    expect(screen.getByText('暂无提交记录')).toBeInTheDocument();

    rerender(<CommittedChangesPanel page={makePage([])} />);
    expect(screen.getByText('暂无提交记录')).toBeInTheDocument();
  });
});

describe('CommittedChangesPanel 文件列表（选中提交）', () => {
  const entry = makeEntry({
    hash: 'hash-1',
    files: [
      { path: 'a.ts', status: 'A' },
      { path: 'b.ts', status: 'M' },
      { path: 'c.ts', status: 'D' },
      { path: 'd.ts', status: 'R', renameFrom: 'old.ts' },
    ],
  });

  it('渲染各文件行的状态徽标与路径', () => {
    render(<CommittedChangesPanel page={makePage([entry])} selectedHash="hash-1" />);

    expect(screen.getByTestId('committed-file-0')).toHaveTextContent('A');
    expect(screen.getByTestId('committed-file-0')).toHaveTextContent('a.ts');
    expect(screen.getByTestId('committed-file-1')).toHaveTextContent('M');
    expect(screen.getByTestId('committed-file-1')).toHaveTextContent('b.ts');
    expect(screen.getByTestId('committed-file-2')).toHaveTextContent('D');
    expect(screen.getByTestId('committed-file-2')).toHaveTextContent('c.ts');
  });

  it('重命名文件显示 renameFrom（原名 + 箭头 + 新路径）', () => {
    render(<CommittedChangesPanel page={makePage([entry])} selectedHash="hash-1" />);

    const row = screen.getByTestId('committed-file-3');
    expect(row).toHaveTextContent('R');
    expect(row).toHaveTextContent('old.ts');
    expect(row).toHaveTextContent('→');
    expect(row).toHaveTextContent('d.ts');
  });

  it('未选中提交时右栏渲染 EmptyState 引导', () => {
    render(<CommittedChangesPanel page={makePage([entry])} />);
    expect(screen.getByText('选择一个提交查看变更文件')).toBeInTheDocument();
  });

  it('选中提交的 files 为空时右栏渲染 EmptyState', () => {
    render(
      <CommittedChangesPanel
        page={makePage([makeEntry({ hash: 'empty' })])}
        selectedHash="empty"
      />,
    );
    expect(screen.getByText('该提交无文件变更')).toBeInTheDocument();
  });
});

describe('CommittedChangesPanel 交互', () => {
  it('点击提交行以完整哈希调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    render(
      <CommittedChangesPanel
        page={makePage([makeEntry({ hash: 'fullhash123' })])}
        onSelectCommit={onSelectCommit}
      />,
    );

    fireEvent.click(screen.getByTestId('committed-entry-0'));

    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash123');
  });

  it('selectedHash 命中行高亮，右栏展示对应提交的文件', () => {
    const e0 = makeEntry({ hash: 'hash-1', files: [{ path: 'a.ts', status: 'M' }] });
    const e1 = makeEntry({ hash: 'hash-2', files: [{ path: 'b.ts', status: 'A' }] });
    render(<CommittedChangesPanel page={makePage([e0, e1])} selectedHash="hash-2" />);

    expect(screen.getByTestId('committed-entry-0')).not.toHaveStyle({
      backgroundColor: '#e6f4ff',
    });
    expect(screen.getByTestId('committed-entry-1')).toHaveStyle({ backgroundColor: '#e6f4ff' });
    expect(screen.getByTestId('committed-file-0')).toHaveTextContent('b.ts');
  });

  it('点击文件行以 (path, hash) 调 onOpenFile', () => {
    const onOpenFile = vi.fn();
    const entry = makeEntry({ hash: 'hash-1', files: [{ path: 'src/a.ts', status: 'M' }] });
    render(
      <CommittedChangesPanel
        page={makePage([entry])}
        selectedHash="hash-1"
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByTestId('committed-file-0'));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts', 'hash-1');
  });

  it('hasMore 渲染「加载更多」并回调 onLoadMore；loadingMore 置按钮加载态', () => {
    const onLoadMore = vi.fn();
    const page = makePage([makeEntry({ hash: 'hash-1' })], true);
    const { rerender } = render(<CommittedChangesPanel page={page} onLoadMore={onLoadMore} />);

    // 命名用正则：antd loading 态注入 aria-label="loading"，无障碍名变为「loading 加载更多」
    const button = screen.getByRole('button', { name: /加载更多/ });
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(<CommittedChangesPanel page={page} onLoadMore={onLoadMore} loadingMore />);
    expect(screen.getByRole('button', { name: /加载更多/ })).toHaveClass('ant-btn-loading');
  });

  it('hasMore=false 时不渲染「加载更多」按钮', () => {
    render(<CommittedChangesPanel page={makePage([makeEntry({ hash: 'hash-1' })])} />);
    expect(screen.queryByRole('button', { name: /加载更多/ })).not.toBeInTheDocument();
  });
});
