import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine, CommittedEntry, FileVersions } from '@rebased/contracts';
import { BlameChangePane } from './blame-change-pane';

/** Monaco diff 加载器桩：测试不加载真实 monaco（沿既有 diff 组件测试口径） */
const loader = async (): Promise<never> => {
  throw new Error('测试不应加载 monaco');
};

const versions: FileVersions = { before: 'a\n', after: 'b\n' };

function makeLine(lineno: number): BlameLine {
  return {
    lineno,
    hash: `hash${lineno}`,
    shortHash: `abc${lineno}`,
    author: 'Sam',
    authorEmail: 's@example.com',
    dateIso: '2026-01-01T00:00:00+00:00',
    content: `line ${lineno}`,
    previousLineno: null,
    parents: [],
  };
}

function makeEntry(partial: Partial<CommittedEntry> & { hash: string }): CommittedEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: 's',
    author: 'Sam',
    dateIso: '2026-01-01T00:00:00+00:00',
    parents: ['p1'],
    files: [{ path: 'src/app.ts', status: 'M' }],
    ...partial,
  };
}

/** 缺省通道夹具：三个标签都已有数据 */
function renderPane(overrides: Partial<React.ComponentProps<typeof BlameChangePane>> = {}) {
  return render(
    <BlameChangePane
      file="src/app.ts"
      hash="aaaaaa1"
      view="changes"
      entry={makeEntry({ hash: 'aaaaaa1' })}
      changes={{ versions }}
      latest={{ versions }}
      annotate={{ lines: [makeLine(1)] }}
      affected={{ hash: '' }}
      loader={loader}
      {...overrides}
    />,
  );
}

describe('BlameChangePane 操作条（选中提交级出口）', () => {
  it('四个出口各自以选中提交的哈希回调', () => {
    const onOpenCommit = vi.fn();
    const onOpenDiff = vi.fn();
    const onShowAffected = vi.fn();
    const onOpenInHistory = vi.fn();
    renderPane({ onOpenCommit, onOpenDiff, onShowAffected, onOpenInHistory });

    fireEvent.click(screen.getByTestId('blame-action-log'));
    fireEvent.click(screen.getByTestId('blame-action-diff'));
    fireEvent.click(screen.getByTestId('blame-action-affected'));
    fireEvent.click(screen.getByTestId('blame-action-history'));

    expect(onOpenCommit).toHaveBeenCalledWith('aaaaaa1');
    expect(onOpenDiff).toHaveBeenCalledWith('aaaaaa1');
    expect(onShowAffected).toHaveBeenCalledWith('aaaaaa1');
    expect(onOpenInHistory).toHaveBeenCalledWith('aaaaaa1');
  });

  it('未注入的出口不渲染按钮（无死控件）', () => {
    renderPane();
    expect(screen.queryByTestId('blame-action-log')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-action-diff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-action-affected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-action-history')).not.toBeInTheDocument();
  });

  it('没有选中提交（hash 为空串）：整块给空态，不渲染操作条与标签', () => {
    renderPane({ hash: '', entry: null, changes: {}, latest: {}, annotate: {} });
    expect(screen.getByText('暂无提交可查看')).toBeInTheDocument();
    expect(screen.queryByTestId('blame-pane-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-view-changes')).not.toBeInTheDocument();
  });
});

describe('BlameChangePane 三标签', () => {
  it('三个标签齐备，受控 activeKey = view，切换时回调新键', () => {
    const onViewChange = vi.fn();
    renderPane({ onViewChange });
    expect(screen.getByRole('tab', { name: '本文件改动' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '与最新版本差异' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '逐行注解' })).toBeInTheDocument();
    expect(screen.getByTestId('blame-view-changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '逐行注解' }));
    expect(onViewChange).toHaveBeenCalledWith('annotate');
  });

  it('激活「逐行注解」时渲染注解行表，点行回调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    renderPane({ view: 'annotate', onSelectCommit });
    fireEvent.click(screen.getByTestId('blame-line-1'));
    expect(onSelectCommit).toHaveBeenCalledWith('hash1');
  });
});

describe('BlameChangePane 降级提示行（不做伪 diff）', () => {
  it('根提交：标签1 给提示行', () => {
    renderPane({ entry: makeEntry({ hash: 'aaaaaa1', parents: [] }), changes: {} });
    expect(screen.getByTestId('blame-changes-root-hint')).toBeInTheDocument();
    // 提示行优先于数据状态：changes 未给数据，但提示行在就绝不退化成加载态或伪 diff
    expect(screen.queryByTestId('blame-changes-loading')).not.toBeInTheDocument();
  });

  it('重命名：标签1 给「旧 → 新」提示行', () => {
    renderPane({
      entry: makeEntry({ hash: 'aaaaaa1', files: [{ path: 'src/app.ts', status: 'R', renameFrom: 'src/old.ts' }] }),
      changes: {},
    });
    expect(screen.getByTestId('blame-changes-rename-hint')).toHaveTextContent('src/old.ts');
    expect(screen.queryByTestId('blame-changes-loading')).not.toBeInTheDocument();
  });

  it('重命名但原名为空串：不误报重命名提示行，落回正常差异视图', () => {
    renderPane({
      entry: makeEntry({ hash: 'aaaaaa1', files: [{ path: 'src/app.ts', status: 'R', renameFrom: '' }] }),
    });
    expect(screen.queryByTestId('blame-changes-rename-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-changes-loading')).not.toBeInTheDocument();
    // versions 已给且无降级标记 → DiffViewer 的工具条在（正常差异视图，而不是提示行）
    expect(screen.getByTestId('diff-ignore-ws')).toBeInTheDocument();
  });

  it('该提交里没有这个路径：标签1 与标签2 都给提示行（而不是两个空文档）', () => {
    const entry = makeEntry({ hash: 'aaaaaa1', files: [{ path: 'other.ts', status: 'M' }] });
    const { rerender } = renderPane({ entry, changes: {} });
    expect(screen.getByTestId('blame-changes-missing-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('blame-changes-loading')).not.toBeInTheDocument();
    rerender(
      <BlameChangePane
        file="src/app.ts"
        hash="aaaaaa1"
        view="latest"
        entry={entry}
        changes={{}}
        latest={{}}
        annotate={{}}
        affected={{ hash: '' }}
        loader={loader}
      />,
    );
    expect(screen.getByTestId('blame-latest-missing-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('blame-latest-loading')).not.toBeInTheDocument();
  });

  it('变更集未就绪：不误报提示行，按加载态呈现', () => {
    renderPane({ entry: undefined, changes: {} });
    expect(screen.queryByTestId('blame-changes-missing-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('blame-changes-loading')).toBeInTheDocument();
  });
});

describe('BlameChangePane 数据三态与受影响弹窗', () => {
  it('差异错误与加载分别呈现', () => {
    const { rerender } = renderPane({ changes: { error: '拉取失败' } });
    expect(screen.getByTestId('blame-changes-error')).toHaveTextContent('拉取失败');
    rerender(
      <BlameChangePane
        file="src/app.ts"
        hash="aaaaaa1"
        view="latest"
        entry={makeEntry({ hash: 'aaaaaa1' })}
        changes={{}}
        latest={{ loading: true }}
        annotate={{}}
        affected={{ hash: '' }}
        loader={loader}
      />,
    );
    expect(screen.getByTestId('blame-latest-loading')).toBeInTheDocument();
  });

  it('受影响弹窗受控渲染并透传回调', () => {
    const onCloseAffected = vi.fn();
    const onOpenAffectedFile = vi.fn();
    renderPane({
      onShowAffected: vi.fn(),
      onCloseAffected,
      onOpenAffectedFile,
      affected: {
        hash: 'aaaaaa1',
        entry: makeEntry({ hash: 'aaaaaa1', files: [{ path: 'src/other.ts', status: 'M' }] }),
      },
    });
    expect(screen.getByText(/受影响文件（aaaaaa1）/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('affected-file-0'));
    expect(onOpenAffectedFile).toHaveBeenCalledWith('src/other.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCloseAffected).toHaveBeenCalledTimes(1);
  });
});
