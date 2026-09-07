import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileHistoryEntry } from '@rebased/contracts';
import { HistoryPanel } from './history-panel';

/** 测试历史条目工厂：补全 FileHistoryEntry 必填字段 */
function makeEntry(partial: Partial<FileHistoryEntry> & { hash: string }): FileHistoryEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: `subject ${partial.hash}`,
    author: `author ${partial.hash}`,
    dateIso: '2026-01-02T03:04:00Z',
    parents: [],
    ...partial,
  };
}

describe('HistoryPanel 渲染', () => {
  it('渲染文件路径头与条目的短哈希/subject/作者/日期', () => {
    const entries = [
      makeEntry({ hash: 'hash-1', subject: 'fix: a' }),
      makeEntry({ hash: 'hash-2', subject: 'feat: b' }),
    ];
    render(<HistoryPanel file="src/app.ts" entries={entries} />);

    expect(screen.getByTestId('history-file')).toHaveTextContent('src/app.ts');

    const row1 = screen.getByTestId('history-entry-0');
    expect(row1).toHaveTextContent('hash-1');
    expect(row1).toHaveTextContent('fix: a');
    expect(row1).toHaveTextContent('author hash-1');
    expect(row1).toHaveTextContent('2026-01-02 03:04');

    const row2 = screen.getByTestId('history-entry-1');
    expect(row2).toHaveTextContent('feat: b');
    expect(row2).toHaveTextContent('author hash-2');
    expect(row2).toHaveTextContent('2026-01-02 03:04');
  });

  it('无条目时渲染 EmptyState', () => {
    render(<HistoryPanel file="src/app.ts" entries={[]} />);
    expect(screen.getByText('暂无历史记录')).toBeInTheDocument();
  });
});

describe('HistoryPanel 状态', () => {
  it('loading 时渲染加载态', () => {
    render(<HistoryPanel file="src/app.ts" loading />);
    expect(screen.getByTestId('history-loading')).toBeInTheDocument();
  });

  it('error 时渲染错误文案', () => {
    render(<HistoryPanel file="src/app.ts" error="加载失败" />);
    expect(screen.getByTestId('history-error')).toHaveTextContent('加载失败');
  });
});

describe('HistoryPanel 行交互', () => {
  it('点击条目以完整哈希调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    render(
      <HistoryPanel file="src/app.ts" entries={[makeEntry({ hash: 'fullhash123' })]} onSelectCommit={onSelectCommit} />,
    );

    fireEvent.click(screen.getByTestId('history-entry-0'));

    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash123');
  });

  it('双击条目以 (hash, parents) 调 onOpenDiff', () => {
    const onOpenDiff = vi.fn();
    render(
      <HistoryPanel
        file="src/app.ts"
        entries={[makeEntry({ hash: 'fullhash123', parents: ['parent111'] })]}
        onOpenDiff={onOpenDiff}
      />,
    );

    fireEvent.doubleClick(screen.getByTestId('history-entry-0'));

    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    expect(onOpenDiff).toHaveBeenCalledWith('fullhash123', ['parent111']);
  });

  it('Annotate 按钮：点击回调带 hash 且不触发行选中', () => {
    const onSelectCommit = vi.fn();
    const onAnnotate = vi.fn();
    render(
      <HistoryPanel
        file="src/app.ts"
        entries={[makeEntry({ hash: 'fullhash123' })]}
        onSelectCommit={onSelectCommit}
        onAnnotate={onAnnotate}
      />,
    );

    fireEvent.click(screen.getByTestId('history-annotate-0'));

    expect(onAnnotate).toHaveBeenCalledWith('fullhash123');
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  it('未传 onAnnotate 时不渲染按钮', () => {
    render(<HistoryPanel file="src/app.ts" entries={[makeEntry({ hash: 'h' })]} />);
    expect(screen.queryByTestId('history-annotate-0')).not.toBeInTheDocument();
  });
});
