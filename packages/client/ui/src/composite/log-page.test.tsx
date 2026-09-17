import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo, RepoStatus } from '@rebased/contracts';
import { LogPage } from './log-page';

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

const status: RepoStatus = { branch: 'main', upstream: 'origin/main', headHash: 'a'.repeat(40), ahead: 0, behind: 0, entries: [] };

const commits: CommitInfo[] = [
  makeCommit({ hash: 'c2', parents: ['c1'], message: '第二笔提交' }),
  makeCommit({ hash: 'c1', parents: [], message: '初始提交' }),
];

describe('LogPage', () => {
  it('渲染仓库名、RepoStatusBar 与 CommitGraph 行', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(2);
  });

  it('点击提交行触发 onSelectCommit(hash)', () => {
    const onSelectCommit = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onSelectCommit={onSelectCommit} />);
    fireEvent.click(screen.getByText('初始提交'));
    expect(onSelectCommit).toHaveBeenCalledWith('c1');
  });

  it('未选中提交时不渲染详情面板', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={null} />);
    expect(screen.queryByTestId('commit-details')).not.toBeInTheDocument();
  });

  it('传入 operation 与 onAbortOperation 时顶栏渲染进行中操作条', () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        operation={{ kind: 'merge' }}
        onAbortOperation={() => {}}
      />,
    );
    expect(screen.getByText('合并中')).toBeInTheDocument();
  });

  // 冒烟 F-015：tag chips 默认关（对齐 showTagNames 默认 false），过滤行开关打开后出现
  it('过滤行「标签」开关切换 tag chips 显示', () => {
    const tagged: CommitInfo[] = [makeCommit({ hash: 't1', refs: ['main', 'tag: v1.0'], message: '带标签' })];
    render(<LogPage repoName="alpha" status={status} commits={tagged} filters={{}} onFiltersChange={() => {}} />);
    expect(screen.getByTestId('ref-chip-main')).toBeInTheDocument();
    expect(screen.queryByText('v1.0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('log-show-tags'));
    expect(screen.getByText('v1.0')).toBeInTheDocument();
  });

  it('缺 onAbortOperation 时不渲染操作条', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} operation={{ kind: 'merge' }} />);
    expect(screen.queryByText('合并中')).not.toBeInTheDocument();
  });

  it('传入 onOpenSettings 时点击设置按钮触发回调', () => {
    const onOpenSettings = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenSettings 时不渲染设置按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
  });

  it('传入 onOpenStatus 时点击变更按钮触发回调', () => {
    const onOpenStatus = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenStatus={onOpenStatus} />);
    fireEvent.click(screen.getByRole('button', { name: '变更' }));
    expect(onOpenStatus).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenStatus 时不渲染变更按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '变更' })).not.toBeInTheDocument();
  });

  it('传入 onOpenBranches 时点击分支按钮触发回调', () => {
    const onOpenBranches = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenBranches={onOpenBranches} />);
    fireEvent.click(screen.getByRole('button', { name: '分支' }));
    expect(onOpenBranches).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenBranches 时不渲染分支按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '分支' })).not.toBeInTheDocument();
  });

  it('选中提交后右侧渲染 CommitDetailsPanel', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '被选中的提交' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.getByTestId('commit-details')).toBeInTheDocument();
    expect(screen.getByText('被选中的提交')).toBeInTheDocument();
    expect(screen.getByText('c9selec')).toBeInTheDocument();
  });

  describe('就地快照栏（浏览快照开关）', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '被选中的提交' });
    const entries = [
      { mode: '100644', type: 'blob' as const, hash: 'h1', path: 'src/a.ts' },
      { mode: '100644', type: 'blob' as const, hash: 'h2', path: 'README.md' },
    ];

    it('未展开时是两栏：不渲染快照标签栏，作者与日期列照常显示', () => {
      render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
      expect(screen.queryByTestId('snapshot-tabs')).not.toBeInTheDocument();
      expect(screen.queryByTestId('snapshot-tree-title')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('commit-graph-author').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('commit-graph-date').length).toBeGreaterThan(0);
    });

    it('展开后是三栏：日志 | 详情 | 快照（快照栏里是文件树 + 文件标签页）', () => {
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
        />,
      );
      // 栏宿主三个（文件树与文件内容已合并进快照栏，不再是两栏）
      expect(
        screen
          .getAllByTestId(/^resizable-pane-/)
          .map((p) => p.dataset.testid),
      ).toEqual(['resizable-pane-log', 'resizable-pane-details', 'resizable-pane-snapshot']);
      // 三栏 → 两条分隔条，全部由 antd Splitter 绘制（不再自绘）
      expect(document.querySelectorAll('.ant-splitter-bar')).toHaveLength(2);
      // 快照栏 = 标签栏：第一个标签是文件树（带总数）；版本短名 chip 已按用户口径删除，标签栏右端空着
      expect(screen.getByTestId('snapshot-tabs')).toBeInTheDocument();
      expect(screen.getByTestId('snapshot-tree-title')).toHaveTextContent('文件（2）');
      expect(screen.queryByTestId('snapshot-tree-rev')).not.toBeInTheDocument();
    });

    it('文件树是标签栏的第一个标签且不可关闭（关掉它就没有挑文件的入口）', () => {
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
        />,
      );
      const treeTab = screen.getByTestId('snapshot-tree-title').closest('.ant-tabs-tab');
      expect(treeTab?.querySelector('.ant-tabs-tab-remove')).toBeNull();
      // 树本体挂在「文件」标签页里（不是另起一栏）
      expect(screen.getByTestId('snapshot-tree-pane')).toContainElement(screen.getByText('README.md'));
    });

    it('关掉文件标签：回「文件」标签并要求容器清空 ?file=（沿用「同路径再点即收起」的 toggle 语义）', () => {
      const onSelectBrowseFile = vi.fn();
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
          browseSelectedPath="src/a.ts"
          browseContent={{ content: 'hello', binary: false }}
          onSelectBrowseFile={onSelectBrowseFile}
        />,
      );
      expect(screen.getByTestId('snapshot-file-tab-src/a.ts')).toBeInTheDocument();
      const remove = screen.getByTestId('snapshot-file-tab-src/a.ts').closest('.ant-tabs-tab')?.querySelector('.ant-tabs-tab-remove');
      fireEvent.click(remove as Element);
      expect(onSelectBrowseFile).toHaveBeenCalledWith('src/a.ts');
      expect(document.querySelector('.ant-tabs-tab-active')).toHaveTextContent('文件（2）');
    });

    it('点「文件」标签回到树，同样按 toggle 语义清空容器选中', () => {
      const onSelectBrowseFile = vi.fn();
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
          browseSelectedPath="src/a.ts"
          browseContent={{ content: 'hello', binary: false }}
          onSelectBrowseFile={onSelectBrowseFile}
        />,
      );
      fireEvent.click(screen.getByTestId('snapshot-tree-title'));
      expect(onSelectBrowseFile).toHaveBeenCalledWith('src/a.ts');
    });

    it('多个文件可同时开着：容器换选中就多一个标签，旧标签留着（编辑器式）', () => {
      const { rerender } = render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
          browseSelectedPath="src/a.ts"
          browseContent={{ content: 'AAA', binary: false }}
        />,
      );
      rerender(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
          browseSelectedPath="README.md"
          browseContent={{ content: 'BBB', binary: false }}
        />,
      );
      expect(screen.getByTestId('snapshot-file-tab-src/a.ts')).toBeInTheDocument();
      expect(screen.getByTestId('snapshot-file-tab-README.md')).toBeInTheDocument();
    });

    it('快照栏不再用 Card（去边框、更紧凑）', () => {
      const { container } = render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
        />,
      );
      expect(container.querySelectorAll('.ant-card')).toHaveLength(0);
    });

    it('作者/日期两列的显隐改由日志栏**实测宽度**驱动，与是否展开快照无关', () => {
      // 旧口径（展开快照就隐列）已作废：用户要求改为宽度驱动（阈值 512，见 AUTHOR_COLUMN_MIN_WIDTH）。
      // jsdom 下量不到真实宽度（offsetWidth 恒 0），此时按「静默放行」处理——两列照常渲染，
      // 不会因为量不到就永久隐藏。真实阈值切换由 commit-graph 的 showAuthor/showDate 用例覆盖，
      // 拖动过程中的实时切换在 :3081 冒烟里核（ResizeObserver 在 jsdom 不触发）。
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
        />,
      );
      expect(screen.getAllByTestId('commit-graph-author').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('commit-graph-date').length).toBeGreaterThan(0);
    });

    it('「浏览快照」按钮在展开时呈主按钮选中态（再点一次即收起）', () => {
      // 只看开关态：浏览快照按钮要 onBrowse 注入才渲染（既有约定），故这里给一个空实现
      const { unmount } = render(
        <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onBrowse={() => {}} />,
      );
      expect(screen.getByTestId('browse-snapshot')).not.toHaveClass('ant-btn-primary');
      unmount();
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          onBrowse={() => {}}
          browseOpen
          browseRev="c9selec"
        />,
      );
      expect(screen.getByTestId('browse-snapshot')).toHaveClass('ant-btn-primary');
    });

    it('树里点文件把路径交给容器（开标签由容器回传的选中项驱动）', () => {
      const onSelectBrowseFile = vi.fn();
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
          onSelectBrowseFile={onSelectBrowseFile}
        />,
      );
      // FileTree 的叶子以完整路径为 key，点击即回调该路径（目录点击是展开/收起，不回调）
      fireEvent.click(screen.getByText('README.md'));
      expect(onSelectBrowseFile).toHaveBeenCalledWith('README.md');
    });

    it('容器回传选中文件：该文件开成一个标签页并渲染路径栏与正文', () => {
      render(
        <LogPage
          repoName="alpha"
          status={status}
          commits={commits}
          selectedCommit={selected}
          browseOpen
          browseRev="c9selec"
          browseEntries={entries}
          browseSelectedPath="src/a.ts"
          browseContent={{ content: 'hello\nworld', binary: false }}
        />,
      );
      expect(screen.getByTestId('browse-content-path')).toHaveTextContent('src/a.ts');
      // 正文交给 Monaco 只读编辑器（行号/高亮/横向滚动都由编辑器负责），故这里只断言宿主在
      expect(screen.getByTestId('browse-code-editor')).toBeInTheDocument();
    });

    it('树加载中/出错时各有占位', () => {
      const { unmount } = render(
        <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} browseOpen browseRev="c9selec" browseLoading />,
      );
      expect(screen.getByTestId('browse-loading')).toBeInTheDocument();
      unmount();
      render(
        <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} browseOpen browseRev="c9selec" browseError="无效的 ref" />,
      );
      expect(screen.getByTestId('browse-error')).toHaveTextContent('无效的 ref');
    });
  });

  it('详情面板父提交链接透传 onSelectCommit（点击选中父提交）', () => {
    const selected = makeCommit({ hash: 'c9selected0001', parents: ['c1'], message: '被选中的提交' });
    const onSelectCommit = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        onSelectCommit={onSelectCommit}
      />,
    );
    fireEvent.click(screen.getByTestId('parent-link'));
    expect(onSelectCommit).toHaveBeenCalledWith('c1');
  });

  it('顶栏「首页 + 仓库名」以面包屑展示：传入 onGoHome 时「首页」可点并回调', () => {
    const onGoHome = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onGoHome={onGoHome} />);
    // 面包屑：两级都在这条导航链里（首页 / alpha）
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('首页');
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('alpha');
    fireEvent.click(screen.getByTestId('log-go-home'));
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('未传 onGoHome 时面包屑没有「首页」一级（不渲染点了没反应的「首页」）', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('alpha');
    expect(screen.queryByTestId('log-go-home')).not.toBeInTheDocument();
  });

  it('传入 onUndoCommit 时渲染撤销最近提交按钮，Popconfirm 确认后回调', async () => {
    const onUndoCommit = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onUndoCommit={onUndoCommit} />);
    fireEvent.click(screen.getByRole('button', { name: '撤销最近提交' }));
    expect(await screen.findByText('将撤销最近提交并保留改动到暂存区')).toBeInTheDocument();
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onUndoCommit).toHaveBeenCalledTimes(1);
  });

  it('未传 onUndoCommit 时不渲染撤销按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '撤销最近提交' })).not.toBeInTheDocument();
  });

  it('undoCommitting 时撤销按钮进入 loading 态', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onUndoCommit={() => {}} undoCommitting />);
    expect(screen.getByRole('button', { name: '撤销最近提交' })).toHaveClass('ant-btn-loading');
  });

  it('传入 onResetHere 时透传给详情面板，点击回调带选中提交 hash', () => {
    const onResetHere = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onResetHere={onResetHere} />,
    );
    fireEvent.click(screen.getByTestId('reset-here'));
    expect(onResetHere).toHaveBeenCalledWith('c9selected0001');
  });

  it('未传 onResetHere 时详情面板不渲染 Reset 按钮', () => {
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.queryByTestId('reset-here')).not.toBeInTheDocument();
  });

  it('「查看变更集」（#13）：详情按钮回调 hash；变更集以快照栏标签呈现（不再是 Modal），点文件行回调容器', () => {
    const onOpenChanges = vi.fn();
    const onOpenChangedFile = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001', message: '带变更的提交' });
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        onOpenChanges={onOpenChanges}
        changesHash="c9selected0001"
        changesEntry={{
          hash: 'c9selected0001',
          shortHash: 'c9selec',
          subject: '带变更的提交',
          author: 'Test User',
          dateIso: '2026-01-02T00:00:00.000Z',
          parents: ['c1'],
          files: [
            { path: 'a.txt', status: 'M' },
            { path: 'b.txt', status: 'A' },
            { path: 'old.txt', status: 'R', renameFrom: 'renamed.txt' },
          ],
        }}
        onCloseChanges={() => {}}
        onOpenChangedFile={onOpenChangedFile}
      />,
    );
    fireEvent.click(screen.getByTestId('open-changes'));
    expect(onOpenChanges).toHaveBeenCalledWith('c9selected0001');
    // 变更集是快照栏标签栏里的一个标签（标签名带文件数），弹窗形态已删除
    expect(screen.getByTestId('snapshot-changeset-title')).toHaveTextContent('变更集（3）');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('changes-file-a.txt'));
    expect(onOpenChangedFile).toHaveBeenCalledTimes(1);
    expect(onOpenChangedFile).toHaveBeenCalledWith('a.txt');
    // 重命名行：原名 → 路径 展示
    expect(screen.getByText('renamed.txt → old.txt')).toBeInTheDocument();
  });

  it('变更集标签：loading → Skeleton；error → Alert；未传 onOpenChanges 不渲染详情按钮', () => {
    const selected = makeCommit({ hash: 'c9selected0001' });
    const { rerender } = render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        onOpenChanges={() => {}}
        changesHash="c9selected0001"
        changesLoading
      />,
    );
    expect(document.querySelector('.ant-skeleton')).toBeInTheDocument();
    rerender(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        onOpenChanges={() => {}}
        changesHash="c9selected0001"
        changesError="boom"
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
    rerender(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />,
    );
    expect(screen.queryByTestId('open-changes')).not.toBeInTheDocument();
  });

  it('变更集差异标签（受控）：容器点名的差异文件直接激活；R 重命名只给提示行（不渲染伪 diff）', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '带重命名的提交' });
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        changesHash="c9selected0001"
        changesEntry={{
          hash: 'c9selected0001',
          shortHash: 'c9selec',
          subject: '带重命名的提交',
          author: 'Test User',
          dateIso: '2026-01-02T00:00:00.000Z',
          parents: ['c1'],
          files: [{ path: 'old.txt', status: 'R', renameFrom: 'renamed.txt' }],
        }}
        changesDiff={{ open: ['old.txt'], active: 'old.txt' }}
      />,
    );
    expect(screen.getByTestId('changes-diff-tab-old.txt')).toBeInTheDocument();
    expect(document.querySelector('.ant-tabs-tab-active')?.textContent).toContain('old.txt');
    expect(screen.getByTestId('changes-diff-rename-hint')).toBeInTheDocument();
  });

  it('两个开关各自显隐（用户口径）：只开「查看变更集」也出右栏，但没有文件树那一族标签', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '带变更的提交' });
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        // browseOpen 缺省 = 「浏览快照」关着；changesHash 非空 = 「查看变更集」开着
        changesHash="c9selected0001"
        changesEntry={{
          hash: 'c9selected0001',
          shortHash: 'c9selec',
          subject: '带变更的提交',
          author: 'Test User',
          dateIso: '2026-01-02T00:00:00.000Z',
          parents: ['c1'],
          files: [{ path: 'a.txt', status: 'M' }],
        }}
        browseEntries={[{ mode: '100644', type: 'blob', hash: 'h1', path: 'README.md' }]}
      />,
    );
    // 右栏在（三栏：日志｜详情｜快照栏），但栏内只有变更集那一族
    const panes = screen.getAllByTestId(/^resizable-pane-/).map((p) => p.dataset.testid);
    expect(panes).toEqual(['resizable-pane-log', 'resizable-pane-details', 'resizable-pane-snapshot']);
    expect(screen.getByTestId('snapshot-changeset-title')).toHaveTextContent('变更集（1）');
    expect(screen.queryByTestId('snapshot-tree-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-tree-pane')).not.toBeInTheDocument();
  });

  it('两个开关各自显隐：只开「浏览快照」时没有变更集标签；两个都关时回到两栏（无右栏）', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '带变更的提交' });
    const entries = [{ mode: '100644' as const, type: 'blob' as const, hash: 'h1', path: 'README.md' }];
    const { rerender } = render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} browseOpen browseEntries={entries} />,
    );
    expect(screen.getByTestId('snapshot-tree-title')).toHaveTextContent('文件（1）');
    expect(screen.queryByTestId('snapshot-changeset-title')).not.toBeInTheDocument();
    rerender(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    // 两个开关都关：右栏不渲染（两栏 SplitPane），也没有任何快照标签栏
    expect(screen.queryByTestId('snapshot-tabs')).not.toBeInTheDocument();
    expect(screen.getByTestId('commit-details')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-splitter-bar')).toHaveLength(1);
  });

  it('详情面板两个按钮各按自己的开关显选中态（互不代劳：变更集开着不等于浏览快照开着）', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '带变更的提交' });
    const { rerender } = render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        onBrowse={() => {}}
        onOpenChanges={() => {}}
        changesHash="c9selected0001"
        changesActive
      />,
    );
    // 变更集开着：它自己的按钮呈主按钮态；浏览快照按钮仍是默认态
    expect(screen.getByTestId('open-changes')).toHaveClass('ant-btn-primary');
    expect((screen.getByTestId('browse-snapshot') as HTMLElement).closest('button')).not.toHaveClass('ant-btn-primary');
    rerender(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={selected}
        onBrowse={() => {}}
        onOpenChanges={() => {}}
        browseOpen
      />,
    );
    expect(screen.getByTestId('browse-snapshot')).toHaveClass('ant-btn-primary');
    expect(screen.getByTestId('open-changes')).not.toHaveClass('ant-btn-primary');
  });

  it('传入 onOpenMerge 时点击合并按钮触发回调', () => {
    const onOpenMerge = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenMerge={onOpenMerge} />);
    fireEvent.click(screen.getByRole('button', { name: '合并' }));
    expect(onOpenMerge).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenMerge 时不渲染合并按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '合并' })).not.toBeInTheDocument();
  });

  it('传入 onOpenStashes 时点击贮藏按钮触发回调', () => {
    const onOpenStashes = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenStashes={onOpenStashes} />);
    fireEvent.click(screen.getByRole('button', { name: '贮藏' }));
    expect(onOpenStashes).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenStashes 时不渲染贮藏按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '贮藏' })).not.toBeInTheDocument();
  });

  it('operation.kind 为 merge 且传入 onOpenConflicts 时渲染「去解决冲突」，点击触发回调', () => {
    const onOpenConflicts = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        operation={{ kind: 'merge' }}
        onOpenConflicts={onOpenConflicts}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '去解决冲突' }));
    expect(onOpenConflicts).toHaveBeenCalledTimes(1);
  });

  it('operation.kind 非 merge 时即使传入 onOpenConflicts 也不渲染「去解决冲突」', () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        operation={{ kind: 'cherry-pick' }}
        onOpenConflicts={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: '去解决冲突' })).not.toBeInTheDocument();
  });

  it('未传 onOpenConflicts 时不渲染「去解决冲突」', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} operation={{ kind: 'merge' }} />);
    expect(screen.queryByRole('button', { name: '去解决冲突' })).not.toBeInTheDocument();
  });

  /** 打开顶栏「更多」下拉菜单（Dropdown trigger 为 click，菜单挂到 body） */
  async function openMoreMenu(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    await screen.findByRole('menu');
  }

  it('传入 onOpenPull 时「更多」菜单含拉取项，点击触发回调', async () => {
    const onOpenPull = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={onOpenPull} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('拉取'));
    expect(onOpenPull).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenPush 时「更多」菜单含推送项，点击触发回调', async () => {
    const onOpenPush = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPush={onOpenPush} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('推送'));
    expect(onOpenPush).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenUpdate 时「更多」菜单含更新项目项，点击触发回调', async () => {
    const onOpenUpdate = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenUpdate={onOpenUpdate} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('更新项目'));
    expect(onOpenUpdate).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenRemotes 时「更多」菜单含远程管理项，点击触发回调', async () => {
    const onOpenRemotes = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenRemotes={onOpenRemotes} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('远程管理'));
    expect(onOpenRemotes).toHaveBeenCalledTimes(1);
  });

  it('仅传部分远程入口时「更多」菜单只含对应项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} onOpenRemotes={() => {}} />);
    await openMoreMenu();
    expect(screen.getByText('拉取')).toBeInTheDocument();
    expect(screen.getByText('远程管理')).toBeInTheDocument();
    expect(screen.queryByText('推送')).not.toBeInTheDocument();
    expect(screen.queryByText('更新项目')).not.toBeInTheDocument();
  });

  it('四个远程入口回调均未传时不渲染「更多」按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
  });

  it('传入 onOpenRebase 时「更多」菜单含变基项，点击触发回调', async () => {
    const onOpenRebase = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenRebase={onOpenRebase} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('变基'));
    expect(onOpenRebase).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenTags 时「更多」菜单含标签项，点击触发回调', async () => {
    const onOpenTags = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenTags={onOpenTags} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('标签'));
    expect(onOpenTags).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenRebase/onOpenTags 时「更多」菜单不含变基/标签项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('变基')).not.toBeInTheDocument();
    expect(screen.queryByText('标签')).not.toBeInTheDocument();
  });

  it('仅传 onOpenRebase 时「更多」菜单只含变基项（标签与远程项缺省）', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenRebase={() => {}} />);
    await openMoreMenu();
    expect(screen.getByText('变基')).toBeInTheDocument();
    expect(screen.queryByText('标签')).not.toBeInTheDocument();
    expect(screen.queryByText('拉取')).not.toBeInTheDocument();
  });

  it('仅传 onOpenTags 时「更多」菜单只含标签项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenTags={() => {}} />);
    await openMoreMenu();
    expect(screen.getByText('标签')).toBeInTheDocument();
    expect(screen.queryByText('变基')).not.toBeInTheDocument();
    expect(screen.queryByText('推送')).not.toBeInTheDocument();
  });

  it('传入 onOpenBlame 时「更多」菜单含溯源项，点击触发回调', async () => {
    const onOpenBlame = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenBlame={onOpenBlame} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('溯源'));
    expect(onOpenBlame).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenHistory 时「更多」菜单含历史项，点击触发回调', async () => {
    const onOpenHistory = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenHistory={onOpenHistory} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('历史'));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenCommitted 时「更多」菜单含已提交项，点击触发回调', async () => {
    const onOpenCommitted = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenCommitted={onOpenCommitted} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('已提交'));
    expect(onOpenCommitted).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenSearch 时「更多」菜单含搜索项，点击触发回调', async () => {
    const onOpenSearch = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenSearch={onOpenSearch} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('搜索'));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('未传四入口回调时「更多」菜单不含溯源/历史/已提交/搜索项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('溯源')).not.toBeInTheDocument();
    expect(screen.queryByText('历史')).not.toBeInTheDocument();
    expect(screen.queryByText('已提交')).not.toBeInTheDocument();
    expect(screen.queryByText('搜索')).not.toBeInTheDocument();
  });

  it('传入 onOpenPatches 时「更多」菜单含补丁项，点击触发回调', async () => {
    const onOpenPatches = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPatches={onOpenPatches} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('补丁'));
    expect(onOpenPatches).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenShelves 时「更多」菜单含搁置项，点击触发回调', async () => {
    const onOpenShelves = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenShelves={onOpenShelves} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('搁置'));
    expect(onOpenShelves).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenConsole 时「更多」菜单含控制台项，点击触发回调', async () => {
    const onOpenConsole = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenConsole={onOpenConsole} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('控制台'));
    expect(onOpenConsole).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenIgnore 时「更多」菜单含忽略项，点击触发回调', async () => {
    const onOpenIgnore = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenIgnore={onOpenIgnore} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('忽略'));
    expect(onOpenIgnore).toHaveBeenCalledTimes(1);
  });

  it('未传四入口回调时「更多」菜单不含补丁/搁置/控制台/忽略项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('补丁')).not.toBeInTheDocument();
    expect(screen.queryByText('搁置')).not.toBeInTheDocument();
    expect(screen.queryByText('控制台')).not.toBeInTheDocument();
    expect(screen.queryByText('忽略')).not.toBeInTheDocument();
  });

  it('传入 onOpenGithub 且 githubAvailable 时「更多」菜单含 GitHub 面板项，点击触发回调', async () => {
    const onOpenGithub = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenGithub={onOpenGithub}
        githubAvailable
      />,
    );
    await openMoreMenu();
    fireEvent.click(screen.getByText('GitHub 面板'));
    expect(onOpenGithub).toHaveBeenCalledTimes(1);
  });

  it('githubAvailable=false 时即使传入 onOpenGithub 也不渲染 GitHub 面板项', async () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenGithub={() => {}}
        githubAvailable={false}
      />,
    );
    await openMoreMenu();
    expect(screen.getByText('拉取')).toBeInTheDocument();
    expect(screen.queryByText('GitHub 面板')).not.toBeInTheDocument();
  });

  it('未传 onOpenGithub/githubAvailable 时「更多」菜单不含 GitHub 面板项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('GitHub 面板')).not.toBeInTheDocument();
  });

  it('传入 onOpenGitlab 且 gitlabAvailable 时「更多」菜单含 GitLab 面板项，点击触发回调', async () => {
    const onOpenGitlab = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenGitlab={onOpenGitlab}
        gitlabAvailable
      />,
    );
    await openMoreMenu();
    fireEvent.click(screen.getByText('GitLab 面板'));
    expect(onOpenGitlab).toHaveBeenCalledTimes(1);
  });

  it('gitlabAvailable=false 时即使传入 onOpenGitlab 也不渲染 GitLab 面板项', async () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenGitlab={() => {}}
        gitlabAvailable={false}
      />,
    );
    await openMoreMenu();
    expect(screen.getByText('拉取')).toBeInTheDocument();
    expect(screen.queryByText('GitLab 面板')).not.toBeInTheDocument();
  });

  it('未传 onOpenGitlab/gitlabAvailable 时「更多」菜单不含 GitLab 面板项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('GitLab 面板')).not.toBeInTheDocument();
  });

  it('传入 onOpenWorktrees 时「更多」菜单含工作树项（无可用性门），点击触发回调', async () => {
    const onOpenWorktrees = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenWorktrees={onOpenWorktrees}
      />,
    );
    await openMoreMenu();
    expect(screen.getByText('工作树')).toBeInTheDocument();
    fireEvent.click(screen.getByText('工作树'));
    expect(onOpenWorktrees).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenSubmodules 时「更多」菜单含子模块项（无可用性门），点击触发回调', async () => {
    const onOpenSubmodules = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenSubmodules={onOpenSubmodules}
      />,
    );
    await openMoreMenu();
    expect(screen.getByText('子模块')).toBeInTheDocument();
    fireEvent.click(screen.getByText('子模块'));
    expect(onOpenSubmodules).toHaveBeenCalledTimes(1);
  });

  it('同时传入 onOpenWorktrees/onOpenSubmodules 时「更多」菜单同时含工作树与子模块项', async () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenWorktrees={() => {}}
        onOpenSubmodules={() => {}}
      />,
    );
    await openMoreMenu();
    expect(screen.getByText('工作树')).toBeInTheDocument();
    expect(screen.getByText('子模块')).toBeInTheDocument();
  });

  it('未传 onOpenWorktrees/onOpenSubmodules 时「更多」菜单不含工作树/子模块项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('工作树')).not.toBeInTheDocument();
    expect(screen.queryByText('子模块')).not.toBeInTheDocument();
  });

  it('传入 onCherryPick 时透传给详情面板，点击回调携带选中提交 hash', () => {
    const onCherryPick = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onCherryPick={onCherryPick} />,
    );
    fireEvent.click(screen.getByTestId('cherry-pick'));
    expect(onCherryPick).toHaveBeenCalledWith('c9selected0001');
  });

  it('传入 onRevert 时透传给详情面板，点击回调携带选中提交 hash', () => {
    const onRevert = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onRevert={onRevert} />,
    );
    fireEvent.click(screen.getByTestId('revert'));
    expect(onRevert).toHaveBeenCalledWith('c9selected0001');
  });

  it('未传 onCherryPick/onRevert 时详情面板不渲染摘樱桃/还原按钮', () => {
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.queryByTestId('cherry-pick')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revert')).not.toBeInTheDocument();
  });
});

describe('LogPage 过滤/分页', () => {
  it('未传 onFiltersChange 时不渲染过滤行', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByTestId('log-filter-row')).not.toBeInTheDocument();
  });

  it('过滤输入回车提交（去首尾空白）', () => {
    const onFiltersChange = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByTestId('log-filter-author'), { target: { value: ' Alice ' } });
    fireEvent.change(screen.getByTestId('log-filter-path'), { target: { value: 'src/main.ts' } });
    fireEvent.keyDown(screen.getByTestId('log-filter-author'), { key: 'Enter' });
    expect(onFiltersChange).toHaveBeenCalledWith({ author: 'Alice', path: 'src/main.ts' });
  });

  it('filters 受控：初始值回显草稿，清空作者后上抛 author:空串（容器按空串清空）+ 既有 path', () => {
    const onFiltersChange = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        filters={{ author: 'Bob', path: 'lib/' }}
        onFiltersChange={onFiltersChange}
      />,
    );
    expect(screen.getByTestId('log-filter-author')).toHaveValue('Bob');
    fireEvent.change(screen.getByTestId('log-filter-author'), { target: { value: '' } });
    fireEvent.blur(screen.getByTestId('log-filter-author'));
    // 新实现恒带 author/path 两个键，故期望值随之显式含 author: ''（空串即「清空该键」，容器按 f.author ?? '' 处理）
    expect(onFiltersChange).toHaveBeenCalledWith({ author: '', path: 'lib/' });
  });

  // 回归：author/path 写入点（applyFilters）必须带上既有 filters，否则容器按 f.branches ?? []
  // 回写会把用户刚选好的分支过滤静默清空、查询从 --all 退回默认视图
  it('author/path 与 branches 共存：提交文本过滤不清空既有分支过滤', () => {
    const onFiltersChange = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        filters={{ branches: ['main'] }}
        onFiltersChange={onFiltersChange}
        branchOptions={['main']}
      />,
    );
    fireEvent.change(screen.getByTestId('log-filter-author'), { target: { value: 'alice' } });
    fireEvent.keyDown(screen.getByTestId('log-filter-author'), { key: 'Enter' });
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ branches: ['main'], author: 'alice' }));
  });

  it('hasMore 与 onLoadMore 提供时渲染「加载更多」；内容填不满视口则挂载即自动按需加载一次，点击再触发一次', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onFiltersChange={() => {}}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    // jsdom 无布局：视口高取 CommitGraph 默认 480，2 行 × 24px 显然填不满 → 挂载即视为「还需要更早的提交」
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('log-load-more'));
    expect(onLoadMore).toHaveBeenCalledTimes(2);

    // hasMore=false（已到最早的提交）：按钮禁用并换文案，且不再注入 onReachBottom → 不再自动加载
    rerender(
      <LogPage repoName="alpha" status={status} commits={commits} onFiltersChange={() => {}} hasMore={false} onLoadMore={onLoadMore} />,
    );
    expect(screen.getByTestId('log-load-more').closest('button')).toBeDisabled();
    expect(screen.getByTestId('log-load-more')).toHaveTextContent('已到最早的提交');
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('loadingMore 期间不注入 onReachBottom（触底是持续状态，回调若在就会连发同页请求）', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <LogPage repoName="alpha" status={status} commits={commits} onFiltersChange={() => {}} hasMore loadingMore onLoadMore={onLoadMore} />,
    );
    expect(onLoadMore).not.toHaveBeenCalled();

    rerender(
      <LogPage repoName="alpha" status={status} commits={commits} onFiltersChange={() => {}} hasMore onLoadMore={onLoadMore} />,
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('未传 onLoadMore 时不渲染「加载更多」', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onFiltersChange={() => {}} hasMore />);
    expect(screen.queryByTestId('log-load-more')).not.toBeInTheDocument();
  });

  // 首屏拉取期间（实测可达数秒）不能把「还在加载」说成「没有提交」或「历史看完了」——
  // 这两句都会让用户以为仓库是空的 / 已经到底了，从而放弃等待或放弃继续加载
  it('initialLoading：空列表渲染加载态而不是「暂无提交」', () => {
    render(<LogPage repoName="alpha" status={status} commits={[]} initialLoading />);
    expect(screen.queryByText('暂无提交')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-skeleton')).not.toBeNull();
  });

  it('initialLoading：加载完成后仍为空才显示「暂无提交」', () => {
    const { rerender } = render(<LogPage repoName="alpha" status={status} commits={[]} initialLoading />);
    rerender(<LogPage repoName="alpha" status={status} commits={[]} initialLoading={false} />);
    expect(screen.getByText('暂无提交')).toBeInTheDocument();
  });

  it('initialLoading：「加载更多」呈加载中且不宣称「已到最早的提交」', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <LogPage repoName="alpha" status={status} commits={[]} initialLoading hasMore={false} onFiltersChange={() => {}} onLoadMore={onLoadMore} />,
    );
    // hasMore=false 只是「还没有数据」，此刻不得写成「已到最早的提交」
    expect(screen.getByTestId('log-load-more')).toHaveTextContent('加载更多');
    expect(screen.getByTestId('log-load-more').closest('button')).toBeDisabled();
    expect(onLoadMore).not.toHaveBeenCalled();

    rerender(
      <LogPage repoName="alpha" status={status} commits={commits} initialLoading={false} hasMore onFiltersChange={() => {}} onLoadMore={onLoadMore} />,
    );
    expect(screen.getByTestId('log-load-more')).toHaveTextContent('加载更多');
  });
});

describe('LogPage 行右键菜单', () => {
  it('右键提交行 → 菜单出现；点击「检出此提交」回调带该行 hash', async () => {
    const onCheckoutRevision = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onCheckoutRevision={onCheckoutRevision}
      />,
    );
    fireEvent.contextMenu(screen.getByText('初始提交'));
    fireEvent.click(await screen.findByText('检出此提交（游离 HEAD）'));
    expect(onCheckoutRevision).toHaveBeenCalledWith('c1');
  });

  it('菜单项仅渲染对应回调注入的项；检查点：未注入 onOpenInBrowser 时不含「在浏览器中打开」', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onCheckoutRevision={() => {}} />);
    fireEvent.contextMenu(screen.getByText('初始提交'));
    expect(await screen.findByText('检出此提交（游离 HEAD）')).toBeInTheDocument();
    expect(screen.queryByText('在浏览器中打开')).not.toBeInTheDocument();
  });

  it('从此处新建分支：Modal 输入名称 → onCheckoutNewBranch(hash, name)', async () => {
    const onCheckoutNewBranch = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onCheckoutNewBranch={onCheckoutNewBranch}
      />,
    );
    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    fireEvent.click(await screen.findByText('从此处新建分支…'));
    fireEvent.change(await screen.findByTestId('log-branch-name'), { target: { value: 'feature/x' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCheckoutNewBranch).toHaveBeenCalledWith('c2', 'feature/x');
  });

  it('从此处新建标签：附注留空 → message undefined；填写 → 原样透传', async () => {
    const onCreateTag = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onCreateTag={onCreateTag} />);
    fireEvent.contextMenu(screen.getByText('初始提交'));
    fireEvent.click(await screen.findByText('从此处新建标签…'));
    fireEvent.change(await screen.findByTestId('log-tag-name'), { target: { value: 'v1.0.0' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreateTag).toHaveBeenCalledWith('c1', 'v1.0.0', undefined);

    fireEvent.contextMenu(screen.getByText('初始提交'));
    fireEvent.click(await screen.findByText('从此处新建标签…'));
    fireEvent.change(await screen.findByTestId('log-tag-name'), { target: { value: 'v2.0.0' } });
    fireEvent.change(screen.getByTestId('log-tag-message'), { target: { value: 'release' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreateTag).toHaveBeenCalledWith('c1', 'v2.0.0', 'release');
  });

  it('右键菜单含既有动作（摘樱桃/还原/Reset/浏览快照）且复用对应回调', async () => {
    const onBrowse = vi.fn();
    const onCherryPick = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        selectedCommit={null}
        onBrowse={onBrowse}
        onCherryPick={onCherryPick}
      />,
    );
    fireEvent.contextMenu(screen.getByText('初始提交'));
    fireEvent.click(await screen.findByText('浏览快照'));
    expect(onBrowse).toHaveBeenCalledWith('c1');
    fireEvent.contextMenu(screen.getByText('初始提交'));
    fireEvent.click(await screen.findByText('摘樱桃'));
    expect(onCherryPick).toHaveBeenCalledWith('c1');
  });

  it('Fixup/Squash Commit：onAutosquash 注入时菜单含两项，点击以 (action, hash) 回调', async () => {
    const onAutosquash = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onAutosquash={onAutosquash}
      />,
    );
    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    fireEvent.click(await screen.findByText('Fixup Commit'));
    expect(onAutosquash).toHaveBeenCalledWith('fixup', 'c2');

    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    fireEvent.click(await screen.findByText('Squash Commit'));
    expect(onAutosquash).toHaveBeenCalledWith('squash', 'c2');
  });

  it('未注入 onAutosquash 时不渲染 Fixup/Squash Commit 菜单项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onCheckoutRevision={() => {}} />);
    fireEvent.contextMenu(screen.getByText('初始提交'));
    expect(await screen.findByText('检出此提交（游离 HEAD）')).toBeInTheDocument();
    expect(screen.queryByText('Fixup Commit')).not.toBeInTheDocument();
    expect(screen.queryByText('Squash Commit')).not.toBeInTheDocument();
  });

  it('Push up to Commit：注入 onPushUpToCommit 时渲染菜单项并以选中行 hash 回调；未注入不渲染', async () => {
    const onPushUpToCommit = vi.fn();
    const { rerender } = render(
      <LogPage repoName="alpha" status={status} commits={commits} onPushUpToCommit={onPushUpToCommit} />,
    );
    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    fireEvent.click(await screen.findByText('Push up to Commit'));
    expect(onPushUpToCommit).toHaveBeenCalledWith('c2');

    rerender(<LogPage repoName="alpha" status={status} commits={commits} onCherryPick={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    expect(await screen.findByText('摘樱桃')).toBeInTheDocument();
    expect(screen.queryByText('Push up to Commit')).not.toBeInTheDocument();
  });

  it('单提交编辑直通：注入 onEditCommit 时渲染 Reword/Drop/Squash/Fixup 菜单；reword 经 Modal 收集新信息', async () => {
    const onEditCommit = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onEditCommit={onEditCommit} />);
    // Drop：直接回调（action + hash）
    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    fireEvent.click(await screen.findByText('Drop Commit'));
    expect(onEditCommit).toHaveBeenCalledWith('drop', 'c2');

    // Reword：Modal 预填当前提交信息首行 → 修改 → 确定 → (action, hash, message)
    fireEvent.contextMenu(screen.getByText('第二笔提交'));
    fireEvent.click(await screen.findByText('Reword Commit'));
    const input = await screen.findByTestId('reword-message-input');
    expect(input).toHaveValue('第二笔提交');
    fireEvent.change(input, { target: { value: 'c2（重写）' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onEditCommit).toHaveBeenCalledWith('reword', 'c2', 'c2（重写）');
  });
});

// 折叠/展开按钮（设计 §2.4 / §3.5）：过滤激活时整组不渲染（对齐 Java setVisible(false)，不是禁用）
describe('线性折叠工具栏', () => {
  const chain: CommitInfo[] = [
    makeCommit({ hash: 'a', parents: ['b'] }),
    makeCommit({ hash: 'b', parents: ['c'] }),
    makeCommit({ hash: 'c', parents: ['d'] }),
    makeCommit({ hash: 'd', parents: [] }),
  ];

  it('渲染折叠/展开按钮；无折叠时展开禁用', () => {
    render(<LogPage repoName="alpha" status={status} commits={chain} filters={{}} onFiltersChange={() => {}} />);
    expect(screen.getByTestId('log-collapse-all')).toBeEnabled();
    expect(screen.getByTestId('log-expand-all')).toBeDisabled();
  });

  it('点「折叠线性分支」后图中只剩两端行，展开按钮转为可用', () => {
    render(<LogPage repoName="alpha" status={status} commits={chain} filters={{}} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByTestId('log-collapse-all'));
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(2);
    expect(screen.getByTestId('log-expand-all')).toBeEnabled();
  });

  it('点「展开线性分支」恢复全部行', () => {
    render(<LogPage repoName="alpha" status={status} commits={chain} filters={{}} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByTestId('log-collapse-all'));
    fireEvent.click(screen.getByTestId('log-expand-all'));
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(4);
  });

  it('分支过滤激活时折叠按钮整组不渲染，且折叠状态被清空', () => {
    const onFiltersChange = vi.fn();
    const { rerender } = render(
      <LogPage repoName="alpha" status={status} commits={chain} filters={{}} onFiltersChange={onFiltersChange} branchOptions={['main']} />,
    );
    fireEvent.click(screen.getByTestId('log-collapse-all'));
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(2);
    rerender(
      <LogPage repoName="alpha" status={status} commits={chain} filters={{ branches: ['main'] }} onFiltersChange={onFiltersChange} branchOptions={['main']} />,
    );
    expect(screen.queryByTestId('log-collapse-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-expand-all')).not.toBeInTheDocument();
    // 清空过滤后回到未折叠状态
    rerender(
      <LogPage repoName="alpha" status={status} commits={chain} filters={{}} onFiltersChange={onFiltersChange} branchOptions={['main']} />,
    );
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(4);
  });
});

// 分支过滤弹窗（设计 §3.6）
describe('分支过滤弹窗', () => {
  const branchy: CommitInfo[] = [
    makeCommit({ hash: 'a', parents: ['b'], refs: ['HEAD -> main'] }),
    makeCommit({ hash: 'b', parents: [], refs: ['origin/side'] }),
  ];

  it('branchOptions 缺省时不渲染过滤入口（避免死控件）', () => {
    render(<LogPage repoName="alpha" status={status} commits={branchy} filters={{}} onFiltersChange={() => {}} />);
    expect(screen.queryByTestId('log-branch-filter')).not.toBeInTheDocument();
  });

  it('打开弹窗并勾选分支 → onFiltersChange 带 branches', async () => {
    const onFiltersChange = vi.fn();
    render(
      <LogPage repoName="alpha" status={status} commits={branchy} filters={{}} onFiltersChange={onFiltersChange} branchOptions={['main', 'origin/side']} />,
    );
    fireEvent.click(screen.getByTestId('log-branch-filter'));
    // antd 的 Dropdown 弹层可能异步挂载（portal + 动画帧），故用 findByTestId 等待
    fireEvent.click(await screen.findByTestId('log-branch-option-main'));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ branches: ['main'] }));
  });

  it('「清空」按钮把 branches 置空', async () => {
    const onFiltersChange = vi.fn();
    render(
      <LogPage repoName="alpha" status={status} commits={branchy} filters={{ branches: ['main'] }} onFiltersChange={onFiltersChange} branchOptions={['main', 'origin/side']} />,
    );
    fireEvent.click(screen.getByTestId('log-branch-filter'));
    fireEvent.click(await screen.findByTestId('log-branch-clear'));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ branches: [] }));
  });

  it('「全选」按钮把 branches 置为全部可选项（内容与顺序都锁定）', async () => {
    const onFiltersChange = vi.fn();
    render(
      <LogPage repoName="alpha" status={status} commits={branchy} filters={{}} onFiltersChange={onFiltersChange} branchOptions={['main', 'origin/side']} />,
    );
    fireEvent.click(screen.getByTestId('log-branch-filter'));
    fireEvent.click(await screen.findByTestId('log-branch-select-all'));
    // 期望值写全量数组（不是长度）：顺序 = branchOptions 注入序，两个可选项一个不漏
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ branches: ['main', 'origin/side'] }));
  });

  it('过滤激活且还有更早提交时给出「尚未加载」降级提示（设计 §7 风险 1）', () => {
    const { rerender } = render(
      <LogPage repoName="alpha" status={status} commits={branchy} filters={{ branches: ['main'] }} onFiltersChange={() => {}} branchOptions={['main']} hasMore />,
    );
    expect(screen.getByTestId('log-branch-filter-hint')).toBeInTheDocument();
    // 已到最早一条 → 不再提示
    rerender(
      <LogPage repoName="alpha" status={status} commits={branchy} filters={{ branches: ['main'] }} onFiltersChange={() => {}} branchOptions={['main']} hasMore={false} />,
    );
    expect(screen.queryByTestId('log-branch-filter-hint')).not.toBeInTheDocument();
    // 未过滤 → 不提示
    rerender(
      <LogPage repoName="alpha" status={status} commits={branchy} filters={{}} onFiltersChange={() => {}} branchOptions={['main']} hasMore />,
    );
    expect(screen.queryByTestId('log-branch-filter-hint')).not.toBeInTheDocument();
  });
});
