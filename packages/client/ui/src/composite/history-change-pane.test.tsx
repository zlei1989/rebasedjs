import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine, CommittedEntry, FileVersions } from '@rebased/contracts';
import { HistoryChangePane } from './history-change-pane';
import type { MonacoEditorInnerProps, MonacoLazyLoader } from '../base/monaco-lazy';

/** Monaco diff 加载器桩：测试不加载真实 monaco（沿既有 diff 组件测试口径） */
const loader = async (): Promise<never> => {
  throw new Error('测试不应加载 monaco');
};

/** 只读代码视图桩：把收到的 props 落成可断言的 DOM（真实编辑器在 jsdom 里起不来，口径同 readonly-text-view 测试） */
const contentLoader: MonacoLazyLoader = () =>
  Promise.resolve({
    default: (props) => {
      const inner = props as MonacoEditorInnerProps;
      return (
        <div
          data-testid="root-content-stub"
          data-language={String(inner.language)}
          data-value={String(inner.value)}
        />
      );
    },
  });

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
    message: 's',
    author: 'Sam',
    dateIso: '2026-01-01T00:00:00+00:00',
    parents: ['p1'],
    files: [{ path: 'src/app.ts', status: 'M' }],
    ...partial,
  };
}

/** 缺省通道夹具：标签都已有数据。`pane` 只造元素，需要 rerender 的用例靠它复用同一份 props */
function pane(overrides: Partial<React.ComponentProps<typeof HistoryChangePane>> = {}) {
  return (
    <HistoryChangePane
      file="src/app.ts"
      hash="aaaaaa1"
      view="changes"
      entry={makeEntry({ hash: 'aaaaaa1' })}
      changes={{ versions }}
      latest={{ versions }}
      annotate={{ lines: [makeLine(1)] }}
      loader={loader}
      {...overrides}
    />
  );
}

/** 缺省整块夹具 */
function renderPane(overrides: Partial<React.ComponentProps<typeof HistoryChangePane>> = {}) {
  return render(pane(overrides));
}

describe('HistoryChangePane 操作条已下线（用户口径：整行删除，四个出口一并去掉）', () => {
  it('不再渲染操作条：文件名与 日志定位/差异页/受影响/文件历史 四个出口都不在盘', () => {
    renderPane();
    expect(screen.queryByTestId('history-pane-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-action-log')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-action-diff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-action-affected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-action-history')).not.toBeInTheDocument();
  });

  it('没有选中提交（hash 为空串）：整块给空态，不渲染标签', () => {
    renderPane({ hash: '', entry: null, changes: {}, latest: {}, annotate: {} });
    expect(screen.getByText('暂无提交可查看')).toBeInTheDocument();
    expect(screen.queryByTestId('history-view-changes')).not.toBeInTheDocument();
  });
});

describe('HistoryChangePane 标签栏', () => {
  it('四个标签齐备，受控 activeKey = view，切换时回调新键', () => {
    const onViewChange = vi.fn();
    renderPane({ onViewChange });
    expect(screen.getByRole('tab', { name: '本文件改动' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '与最新版本差异' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '逐行注解' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '提交详情' })).toBeInTheDocument();
    expect(screen.getByTestId('history-view-changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '逐行注解' }));
    expect(onViewChange).toHaveBeenCalledWith('annotate');
    fireEvent.click(screen.getByRole('tab', { name: '提交详情' }));
    expect(onViewChange).toHaveBeenCalledWith('detail');
  });

  it('激活「逐行注解」时渲染注解行表，点行回调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    renderPane({ view: 'annotate', onSelectCommit });
    fireEvent.click(screen.getByTestId('blame-line-1'));
    expect(onSelectCommit).toHaveBeenCalledWith('hash1');
  });
});

describe('HistoryChangePane「提交详情」标签（复用日志页的详情面板与变更集清单）', () => {
  /** 详情标签夹具：一个带正文、两个变更文件（M + R）的提交 */
  const detailEntry = makeEntry({
    hash: 'aaaaaa1',
    message: 'fix: 主题行\n\n正文第一行\n正文第二行',
    files: [
      { path: 'src/app.ts', status: 'M' },
      { path: 'src/new.ts', status: 'R', renameFrom: 'src/old.ts' },
    ],
  });

  it('详情标签 = 提交详情卡 + 变更集清单（同一份 entry 供两处）', () => {
    renderPane({ view: 'detail', entry: detailEntry });
    expect(screen.getByTestId('history-view-detail')).toBeInTheDocument();
    // 详情卡复用 domain/commit-details-panel：加粗主题、正文块、作者行、短哈希（可点复制完整哈希）
    const card = screen.getByTestId('history-commit-detail');
    expect(card).toHaveTextContent('fix: 主题行');
    expect(screen.getByTestId('commit-body')).toHaveTextContent('正文第二行');
    expect(screen.getByTestId('author-line')).toHaveTextContent('Sam');
    expect(screen.getByTestId('copy-hash')).toHaveTextContent('aaaaaa1');
    // 变更集清单复用 composite/changeset-pane 的 ChangesetList：状态徽标 + 文件名（R 写「旧 → 新」）
    expect(screen.getByTestId('changes-file-src/app.ts')).toHaveTextContent('src/app.ts');
    expect(screen.getByTestId('changes-file-src/new.ts')).toHaveTextContent('src/old.ts → src/new.ts');
    expect(screen.getAllByText('M')).toHaveLength(1);
    expect(screen.getAllByText('R')).toHaveLength(1);
  });

  it('点变更集文件名 → onOpenChangedFile(path)（容器接「新标签页打开该文件的差异页」）', () => {
    const onOpenChangedFile = vi.fn();
    renderPane({ view: 'detail', entry: detailEntry, onOpenChangedFile });
    fireEvent.click(screen.getByTestId('changes-file-src/new.ts'));
    expect(onOpenChangedFile).toHaveBeenCalledWith('src/new.ts');
  });

  it('变更集未就绪：给加载态，而不是「该提交无文件变更」这句错话', () => {
    renderPane({ view: 'detail', entry: undefined, entryState: { loading: true } });
    expect(screen.getByTestId('history-view-detail-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('history-commit-detail')).not.toBeInTheDocument();
    expect(screen.queryByText('该提交无文件变更')).not.toBeInTheDocument();
  });

  it('变更集取数失败：中文错误原样透出（与两个差异标签同一口径）', () => {
    renderPane({ view: 'detail', entry: undefined, entryState: { error: '引用不存在或不是提交：deadbeef' } });
    expect(screen.getByTestId('history-view-detail-error')).toHaveTextContent('引用不存在或不是提交：deadbeef');
  });

  it('空变更集：合并提交与无变更两种空态沿用清单口径', () => {
    const { rerender } = renderPane({ view: 'detail', entry: makeEntry({ hash: 'aaaaaa1', files: [], parents: ['p1', 'p2'] }) });
    expect(screen.getByText('合并提交')).toBeInTheDocument();
    rerender(pane({ view: 'detail', entry: makeEntry({ hash: 'aaaaaa1', files: [] }) }));
    expect(screen.getByText('该提交无文件变更')).toBeInTheDocument();
  });

  it('详情标签不渲染差异视图与注解表（各自的取数通道互不代劳）', () => {
    renderPane({ view: 'detail', entry: detailEntry });
    expect(screen.queryByTestId('diff-ignore-ws')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-line-1')).not.toBeInTheDocument();
  });
});

describe('HistoryChangePane 降级提示行（不做伪 diff）', () => {
  it('根提交：提示行改由 Alert 包裹，下面是该版本的初始内容（只读代码视图 → 语法高亮）', async () => {
    renderPane({
      entry: makeEntry({ hash: 'aaaaaa1', parents: [] }),
      changes: {},
      rootContent: { content: 'const a = 1;' },
      contentLoader,
    });
    // 提示文案逐字不变（e2e 断言按 testid 取它），外面换成 Alert：角色与 testid 都在同一个盒子上
    expect(screen.getByTestId('history-changes-root-hint')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '该提交为根提交（无父版本），无法按父级对比变更；该文件的初始内容可在「逐行注解」标签查看',
    );
    // 下面就是该提交里的文件全文：语言按路径推断（→ 代码高亮），是只读代码视图而不是差异视图
    const stub = await screen.findByTestId('root-content-stub');
    expect(stub).toHaveAttribute('data-value', 'const a = 1;');
    expect(stub).toHaveAttribute('data-language', 'typescript');
    expect(screen.queryByTestId('diff-ignore-ws')).not.toBeInTheDocument();
    // 仍不做伪 diff：changes 通道没数据也不退化成差异加载态
    expect(screen.queryByTestId('history-changes-loading')).not.toBeInTheDocument();
  });

  it('根提交：内容取数三态（加载/错误/二进制）下 Alert 恒在，正文按态切换', async () => {
    const entry = makeEntry({ hash: 'aaaaaa1', parents: [] });
    const rootPane = (rootContent: React.ComponentProps<typeof HistoryChangePane>['rootContent']) =>
      pane({ entry, changes: {}, latest: {}, annotate: {}, rootContent, contentLoader });
    const { rerender } = render(rootPane({ loading: true }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('browse-content-loading')).toBeInTheDocument();
    rerender(rootPane({ error: '读不出来' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('browse-content-error')).toHaveTextContent('读不出来');
    rerender(rootPane({ binary: true }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('browse-binary')).toBeInTheDocument();
    expect(screen.queryByTestId('root-content-stub')).not.toBeInTheDocument();
  });

  it('重命名：标签1 给「旧 → 新」提示行', () => {
    renderPane({
      entry: makeEntry({ hash: 'aaaaaa1', files: [{ path: 'src/app.ts', status: 'R', renameFrom: 'src/old.ts' }] }),
      changes: {},
    });
    expect(screen.getByTestId('history-changes-rename-hint')).toHaveTextContent('src/old.ts');
    expect(screen.queryByTestId('history-changes-loading')).not.toBeInTheDocument();
  });

  it('重命名但原名为空串：不误报重命名提示行，落回正常差异视图', () => {
    renderPane({
      entry: makeEntry({ hash: 'aaaaaa1', files: [{ path: 'src/app.ts', status: 'R', renameFrom: '' }] }),
    });
    expect(screen.queryByTestId('history-changes-rename-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-changes-loading')).not.toBeInTheDocument();
    // versions 已给且无降级标记 → DiffViewer 的工具条在（正常差异视图，而不是提示行）
    expect(screen.getByTestId('diff-ignore-ws')).toBeInTheDocument();
  });

  it('该提交里没有这个路径：标签1 与标签2 都给提示行（而不是两个空文档）', () => {
    const entry = makeEntry({ hash: 'aaaaaa1', files: [{ path: 'other.ts', status: 'M' }] });
    const { rerender } = renderPane({ entry, changes: {} });
    expect(screen.getByTestId('history-changes-missing-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('history-changes-loading')).not.toBeInTheDocument();
    rerender(pane({ view: 'latest', entry, changes: {}, latest: {}, annotate: {} }));
    expect(screen.getByTestId('history-latest-missing-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('history-latest-loading')).not.toBeInTheDocument();
  });

  it('变更集未就绪：不误报提示行，按加载态呈现', () => {
    renderPane({ entry: undefined, changes: {} });
    expect(screen.queryByTestId('history-changes-missing-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-changes-loading')).toBeInTheDocument();
  });
});

describe('HistoryChangePane 数据三态', () => {
  it('差异错误与加载分别呈现', () => {
    const { rerender } = renderPane({ changes: { error: '拉取失败' } });
    expect(screen.getByTestId('history-changes-error')).toHaveTextContent('拉取失败');
    rerender(pane({ view: 'latest', changes: {}, latest: { loading: true }, annotate: {} }));
    expect(screen.getByTestId('history-latest-loading')).toBeInTheDocument();
  });
});
