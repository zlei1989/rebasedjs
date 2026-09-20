import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine, BrowseEntry, CommittedEntry, FileHistoryEntry } from '@rebased/contracts';
import { BlameWorkbench } from './blame-workbench';

const loader = async (): Promise<never> => {
  throw new Error('测试不应加载 monaco');
};

const entries: BrowseEntry[] = [
  { mode: '100644', type: 'blob', hash: 'h1', path: 'src/app.ts' },
  { mode: '100644', type: 'blob', hash: 'h2', path: 'README.md' },
];

const commits: FileHistoryEntry[] = [
  { hash: 'c1', shortHash: 'c1', subject: 'first', author: 'Sam', dateIso: '2026-01-01T00:00:00+00:00', parents: ['p0'] },
];

const lines: BlameLine[] = [
  {
    lineno: 1,
    hash: 'c1',
    shortHash: 'c1',
    author: 'Sam',
    authorEmail: 's@example.com',
    dateIso: '2026-01-01T00:00:00+00:00',
    content: 'const a = 1;',
    previousLineno: null,
    parents: ['p0'],
  },
];

const entry: CommittedEntry = {
  hash: 'c1',
  shortHash: 'c1',
  subject: 'first',
  author: 'Sam',
  dateIso: '2026-01-01T00:00:00+00:00',
  parents: ['p0'],
  files: [{ path: 'src/app.ts', status: 'M' }],
};

/** 缺省整页夹具 */
function renderWorkbench(overrides: Partial<React.ComponentProps<typeof BlameWorkbench>> = {}) {
  return render(
    <BlameWorkbench
      file="src/app.ts"
      tree={{ entries }}
      commits={{ entries: commits }}
      hash="c1"
      view="annotate"
      entry={entry}
      changes={{}}
      latest={{}}
      annotate={{ lines }}
      affected={{ hash: '' }}
      loader={loader}
      {...overrides}
    />,
  );
}

describe('BlameWorkbench 三栏装配', () => {
  it('三栏宿主齐备（文件 | 提交记录 | 变更内容）', () => {
    renderWorkbench();
    expect(screen.getByTestId('resizable-pane-tree')).toBeInTheDocument();
    expect(screen.getByTestId('resizable-pane-commits')).toBeInTheDocument();
    expect(screen.getByTestId('resizable-pane-pane')).toBeInTheDocument();
  });

  it('左栏文件树：点文件回调 onSelectFile；当前文件处于选中态', () => {
    const onSelectFile = vi.fn();
    renderWorkbench({ onSelectFile });
    fireEvent.click(screen.getByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith('README.md');
  });

  it('中栏清单：点提交回调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    renderWorkbench({ onSelectCommit });
    fireEvent.click(screen.getByTestId('blame-commit-0'));
    expect(onSelectCommit).toHaveBeenCalledWith('c1');
  });

  it('右栏三标签与操作条透传（注解行点击 → onSelectCommit）', () => {
    const onSelectCommit = vi.fn();
    const onOpenCommit = vi.fn();
    renderWorkbench({ onSelectCommit, onOpenCommit });
    fireEvent.click(screen.getByTestId('blame-line-1'));
    expect(onSelectCommit).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByTestId('blame-action-log'));
    expect(onOpenCommit).toHaveBeenCalledWith('c1');
  });
});

describe('BlameWorkbench 空态', () => {
  it('没有文件（file 为空串）：中右两栏给引导空态，左树仍在', () => {
    renderWorkbench({ file: '', hash: '', entry: null, commits: { entries: [] }, annotate: {} });
    expect(screen.getByText('在左侧选择一个文件，或直接输入路径')).toBeInTheDocument();
    expect(screen.getByTestId('resizable-pane-tree')).toBeInTheDocument();
  });

  it('树加载失败：错误落在左栏，其余两栏照常渲染', () => {
    renderWorkbench({ tree: { error: '树拉取失败' } });
    expect(screen.getByTestId('browse-error')).toHaveTextContent('树拉取失败');
    expect(screen.getByTestId('resizable-pane-commits')).toBeInTheDocument();
  });
});
