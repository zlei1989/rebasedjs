import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrowseContent, BrowseEntry, CommittedEntry } from '@rebased/contracts';
import { SnapshotTabs } from './snapshot-tabs';

/** 快照条目夹具：两条平铺叶子（树按目录聚合后渲染，与容器真实数据同形） */
const entries: BrowseEntry[] = [
  { mode: '100644', type: 'blob', hash: 'h1', path: 'src/a.ts' },
  { mode: '100644', type: 'blob', hash: 'h2', path: 'README.md' },
];

/** 文件内容夹具：只关心正文，binary 恒 false（二进制另有用例） */
const contentOf = (text: string): BrowseContent => ({ content: text, binary: false });

/** 变更集夹具：一条普通改动 + 一条重命名（R 行要显示「旧 → 新」） */
const changesetEntry: CommittedEntry = {
  hash: 'c9selected0001',
  shortHash: 'c9selec',
  subject: '带变更的提交',
  author: 'Test User',
  dateIso: '2026-01-02T00:00:00.000Z',
  parents: ['p1'],
  files: [
    { path: 'src/a.ts', status: 'M' },
    { path: 'old.txt', status: 'R', renameFrom: 'renamed.txt' },
  ],
};

/** 注入 stub loader，绕过真实 monaco 加载（与 diff-page.test 同一手法） */
const stubLoader = (): Promise<{ default: () => React.ReactNode }> =>
  Promise.resolve({ default: () => <div>stub-diff-editor</div> });

/** 点某个标签的关闭按钮：按标签名的 testid 找到它的 .ant-tabs-tab 容器再点 remove */
function clickRemoveByTestId(testId: string): void {
  const tab = screen.getByTestId(testId).closest('.ant-tabs-tab');
  const remove = tab?.querySelector('.ant-tabs-tab-remove');
  if (remove === null || remove === undefined) throw new Error(`标签 ${testId} 没有关闭按钮`);
  fireEvent.click(remove);
}

/** 点某个文件标签的关闭按钮（卡片式标签渲染 `.ant-tabs-tab-remove`，点击即 onEdit('remove')） */
function clickRemove(path: string): void {
  clickRemoveByTestId(`snapshot-file-tab-${path}`);
}

/** 当前激活标签的文字（antd 把激活态放在 .ant-tabs-tab-active 上） */
function activeTabText(): string {
  return document.querySelector('.ant-tabs-tab-active')?.textContent ?? '';
}

describe('SnapshotTabs（文件树 + 文件内容合并成一条标签栏）', () => {
  it('默认停在「文件」标签：树在第一个标签里、标签名带总数、不可关闭，标签栏右端不再有版本 chip', () => {
    render(<SnapshotTabs entries={entries} />);
    expect(screen.getByTestId('snapshot-tree-title')).toHaveTextContent('文件（2）');
    // 用户口径：标签栏右端的版本短名 chip 已删除
    expect(screen.queryByTestId('snapshot-tree-rev')).not.toBeInTheDocument();
    // 树本体挂在第一个标签里（不是另起一栏）
    expect(screen.getByText('README.md')).toBeInTheDocument();
    // 「文件」标签不给关闭按钮：关掉它就没有挑文件的入口了
    expect(screen.getByTestId('snapshot-tree-title').closest('.ant-tabs-tab')?.querySelector('.ant-tabs-tab-remove')).toBeNull();
    // 还没开过文件：没有文件标签，也没有正文宿主
    expect(screen.queryByTestId('snapshot-file-tab-README.md')).not.toBeInTheDocument();
    expect(screen.queryByTestId('browse-code-editor')).not.toBeInTheDocument();
  });

  it('树里点文件把路径上抛给容器（开标签由容器回传的 selectedPath 驱动）', () => {
    const onSelectFile = vi.fn();
    render(<SnapshotTabs entries={entries} onSelectFile={onSelectFile} />);
    fireEvent.click(screen.getByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith('README.md');
  });

  it('容器回传选中文件：该文件开成一个标签并激活，路径栏与正文宿主就位', () => {
    render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} />);
    expect(screen.getByTestId('snapshot-file-tab-src/a.ts')).toHaveTextContent('a.ts');
    expect(activeTabText()).toContain('a.ts');
    expect(screen.getByTestId('browse-content-path')).toHaveTextContent('src/a.ts');
    expect(screen.getByTestId('browse-code-editor')).toBeInTheDocument();
  });

  it('多个文件同时开着：点已开标签即切回它，并让容器把 ?file= 挪过去', () => {
    const onActivateTab = vi.fn();
    const { rerender } = render(
      <SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={onActivateTab} />,
    );
    rerender(
      <SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('BBB')} onActivateTab={onActivateTab} />,
    );
    expect(screen.getByTestId('snapshot-file-tab-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-file-tab-README.md')).toBeInTheDocument();
    expect(activeTabText()).toContain('README.md');
    fireEvent.click(screen.getByTestId('snapshot-file-tab-src/a.ts'));
    expect(onActivateTab).toHaveBeenCalledWith('src/a.ts');
    expect(activeTabText()).toContain('a.ts');
  });

  it('切回已访问的标签不再回到加载态：用内容副本渲染（编辑器实例保持挂载）', () => {
    const { rerender } = render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} />);
    rerender(<SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('BBB')} />);
    // 两份正文宿主都在：README.md 是容器当前给的那份，src/a.ts 是它被激活时留下的副本
    expect(screen.getAllByTestId('browse-code-editor')).toHaveLength(2);
    expect(screen.queryByTestId('snapshot-file-pending-src/a.ts')).not.toBeInTheDocument();
    // 文件标签激活时**树那一页整个不在 DOM 里**（antd Tabs 默认只挂载激活页的面板，不是 display 隐藏）：
    // 这条锁定的是实测行为——live 上按 `snapshot-tree-pane` 找树会一无所获，别把它当「树渲染失败」。
    // 想按 data-testid 找树，先点「文件（N）」标签把树那一页激活。
    expect(screen.queryByTestId('snapshot-tree-pane')).not.toBeInTheDocument();
    // 点回「文件」标签：树那一页随之挂回（它的 EmptyState/加载态不会残留）
    fireEvent.click(screen.getByTestId('snapshot-tree-title'));
    expect(screen.getByTestId('snapshot-tree-pane')).toBeInTheDocument();
  });

  it('非激活标签页不带行内 display：隐藏靠 antd 的 .ant-tabs-content-hidden，行内 display 会把它盖掉', () => {
    const { rerender } = render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} />);
    rerender(<SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('BBB')} />);
    const hidden = [...document.querySelectorAll<HTMLElement>('.ant-tabs-content')].filter((p) =>
      p.classList.contains('ant-tabs-content-hidden'),
    );
    expect(hidden.length).toBeGreaterThan(0);
    // 行内 display 为空 ⇒ 隐藏规则由 antd 的类生效（实测踩过：行内 display:flex 让所有标签页摊成一列）
    for (const pane of hidden) expect(pane.style.display).toBe('');
  });

  it('容器正在为当前标签拉内容时，已有副本的标签先用副本显示（不闪加载态）', () => {
    const { rerender } = render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} />);
    // 切走再切回（容器回传 a.ts 与「加载中」）：编辑器宿主仍在，Spin 不出现
    rerender(<SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('BBB')} />);
    rerender(<SnapshotTabs entries={entries} selectedPath="src/a.ts" contentLoading onActivateTab={() => {}} />);
    expect(screen.queryByTestId('browse-content-loading')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('browse-code-editor').length).toBeGreaterThan(0);
  });

  it('关闭非当前标签：只把它从标签栏移除，不动容器选中', () => {
    const onActivateTab = vi.fn();
    const { rerender } = render(
      <SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={onActivateTab} />,
    );
    rerender(
      <SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('BBB')} onActivateTab={onActivateTab} />,
    );
    clickRemove('src/a.ts');
    expect(screen.queryByTestId('snapshot-file-tab-src/a.ts')).not.toBeInTheDocument();
    expect(onActivateTab).not.toHaveBeenCalled();
    expect(activeTabText()).toContain('README.md');
  });

  it('关闭当前标签：切到相邻标签并让容器跟着换 ?file=', () => {
    const onActivateTab = vi.fn();
    const { rerender } = render(
      <SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={onActivateTab} />,
    );
    rerender(
      <SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('BBB')} onActivateTab={onActivateTab} />,
    );
    clickRemove('README.md');
    expect(onActivateTab).toHaveBeenCalledWith('src/a.ts');
    expect(activeTabText()).toContain('a.ts');
  });

  it('关闭最后一个文件标签：回到「文件」标签并清空容器的 ?file=', () => {
    const onActivateTab = vi.fn();
    render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={onActivateTab} />);
    clickRemove('src/a.ts');
    expect(onActivateTab).toHaveBeenCalledWith(null);
    expect(activeTabText()).toContain('文件（2）');
  });

  it('点「文件」标签：回到树并清空容器的 ?file=', () => {
    const onActivateTab = vi.fn();
    render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={onActivateTab} />);
    fireEvent.click(screen.getByTestId('snapshot-tree-title'));
    expect(onActivateTab).toHaveBeenCalledWith(null);
    expect(activeTabText()).toContain('文件（2）');
  });

  it('切到「文件」标签不会被容器那份还没清掉的 selectedPath 弹回文件标签', () => {
    render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={() => {}} />);
    fireEvent.click(screen.getByTestId('snapshot-tree-title'));
    // 容器是否真的清空 ?file= 由它自己决定；本组件只在 selectedPath **变化**时对齐，不每帧抢回
    expect(activeTabText()).toContain('文件（2）');
  });

  it('树加载中/出错各有占位（合并成标签页后状态不丢）', () => {
    const { unmount } = render(<SnapshotTabs loading />);
    expect(screen.getByTestId('browse-loading')).toBeInTheDocument();
    unmount();
    render(<SnapshotTabs error="无效的 ref" />);
    expect(screen.getByTestId('browse-error')).toHaveTextContent('无效的 ref');
  });

  it('二进制文件只提示不渲染编辑器（沿既有降级口径）', () => {
    render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={{ content: '', binary: true }} />);
    expect(screen.getByTestId('browse-binary')).toBeInTheDocument();
    expect(screen.queryByTestId('browse-code-editor')).not.toBeInTheDocument();
  });

  it('路径栏动作只剩复制全文：「在新标签页打开」按钮已删除', () => {
    const onCopyAll = vi.fn();
    render(
      <SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onCopyAll={onCopyAll} />,
    );
    fireEvent.click(screen.getByTestId('browse-copy-all'));
    expect(onCopyAll).toHaveBeenCalledTimes(1);
    // 用户口径：路径栏那个导出图标按钮（新标签页打开）已删除，不再渲染
    expect(screen.queryByTestId('browse-open-tab')).not.toBeInTheDocument();
  });

  it('根目录真有个叫 files 的文件：它与「文件」标签不撞键，点它开标签、关它回树', () => {
    const onActivateTab = vi.fn();
    const withFiles = [{ mode: '100644', type: 'blob' as const, hash: 'h9', path: 'files' }];
    render(<SnapshotTabs entries={withFiles} selectedPath="files" content={contentOf('X')} onActivateTab={onActivateTab} />);
    // 两个标签各自独立（撞键时 antd 会同时把两条都算激活，且点文件名会被当成点「文件」标签）
    expect(screen.getByTestId('snapshot-tree-title')).toHaveTextContent('文件（1）');
    expect(screen.getByTestId('snapshot-file-tab-files')).toBeInTheDocument();
    expect(activeTabText()).toContain('files');
    expect(screen.getByTestId('browse-content-path')).toHaveTextContent('files');
    clickRemove('files');
    expect(onActivateTab).toHaveBeenCalledWith(null);
    expect(activeTabText()).toContain('文件（1）');
  });

  it('偏差态：容器还没清 ?file= 时切到树，再关掉那个文件标签也要接管选中', () => {
    const onActivateTab = vi.fn();
    render(<SnapshotTabs entries={entries} selectedPath="src/a.ts" content={contentOf('AAA')} onActivateTab={onActivateTab} />);
    // 点「文件」标签：本地激活树，而容器这一帧仍回传 selectedPath='src/a.ts'（模拟它没清 ?file=）
    fireEvent.click(screen.getByTestId('snapshot-tree-title'));
    onActivateTab.mockClear();
    clickRemove('src/a.ts');
    // 关掉的正是容器选中的那一个 → 必须要求容器清空 ?file=，不能留下「标签没了、URL 还指着它」的死状态
    expect(onActivateTab).toHaveBeenCalledWith(null);
    expect(activeTabText()).toContain('文件（2）');
  });

  it('同名不同目录的两个文件各占一个标签（标签名相同、靠 testid 与 Tooltip 的全路径区分）', () => {
    const onActivateTab = vi.fn();
    const sameName = [
      { mode: '100644', type: 'blob' as const, hash: 'h1', path: 'src/a.ts' },
      { mode: '100644', type: 'blob' as const, hash: 'h2', path: 'lib/a.ts' },
    ];
    const { rerender } = render(
      <SnapshotTabs entries={sameName} selectedPath="src/a.ts" content={contentOf('A')} onActivateTab={onActivateTab} />,
    );
    rerender(<SnapshotTabs entries={sameName} selectedPath="lib/a.ts" content={contentOf('B')} onActivateTab={onActivateTab} />);
    expect(screen.getByTestId('snapshot-file-tab-src/a.ts')).toHaveTextContent('a.ts');
    expect(screen.getByTestId('snapshot-file-tab-lib/a.ts')).toHaveTextContent('a.ts');
    fireEvent.click(screen.getByTestId('snapshot-file-tab-src/a.ts'));
    expect(onActivateTab).toHaveBeenCalledWith('src/a.ts');
  });

  it('未注入 onSelectFile 时点树里的文件不崩（纯展示组件的容错）', () => {
    render(<SnapshotTabs entries={entries} />);
    fireEvent.click(screen.getByText('README.md'));
    expect(screen.getByTestId('snapshot-tabs')).toBeInTheDocument();
  });
});

describe('SnapshotTabs 两个开关各自显隐一族标签（browseTree / changeset）', () => {
  it('只开「查看变更集」（browseTree=false）：没有「文件（N）」标签，挂载即停在变更集清单上', () => {
    render(<SnapshotTabs browseTree={false} changeset={{ entry: changesetEntry }} />);
    expect(screen.queryByTestId('snapshot-tree-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-tree-pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('snapshot-changeset-title')).toHaveTextContent('变更集（2）');
    expect(activeTabText()).toContain('变更集（2）');
  });

  it('只开「浏览快照」：没有变更集标签，停在文件树上（与变更集开关互不代劳）', () => {
    const { unmount } = render(<SnapshotTabs entries={entries} selectedPath="README.md" content={contentOf('A')} />);
    expect(screen.queryByTestId('snapshot-changeset-title')).not.toBeInTheDocument();
    expect(activeTabText()).toContain('README.md');
    unmount();
    // 「浏览快照」关掉时文件树标签随之消失（同一挂载点，逐个切换比较）
    const { unmount: unmountOff } = render(<SnapshotTabs entries={entries} browseTree={false} />);
    expect(screen.queryByTestId('snapshot-tree-title')).not.toBeInTheDocument();
    unmountOff();
    render(<SnapshotTabs entries={entries} />);
    expect(screen.getByTestId('snapshot-tree-title')).toHaveTextContent('文件（2）');
  });

  it('两个都关：标签栏为空（调用方据此不渲染右栏，这里只保证不凭空冒出标签）', () => {
    render(<SnapshotTabs entries={entries} browseTree={false} />);
    expect(screen.queryByTestId('snapshot-tree-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-changeset-title')).not.toBeInTheDocument();
    expect(activeTabText()).toBe('');
  });

  it('变更集开着时再开浏览快照（同一次挂载内变化）：文件树标签出现，已开的差异标签不丢', () => {
    const { rerender } = render(
      <SnapshotTabs browseTree={false} changeset={{ entry: changesetEntry }} diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }} />,
    );
    expect(screen.queryByTestId('snapshot-tree-title')).not.toBeInTheDocument();
    rerender(<SnapshotTabs entries={entries} browseTree changeset={{ entry: changesetEntry }} diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }} />);
    expect(screen.getByTestId('snapshot-tree-title')).toHaveTextContent('文件（2）');
    expect(screen.getByTestId('changes-diff-tab-src/a.ts')).toBeInTheDocument();
    expect(activeTabText()).toContain('a.ts');
  });
});

describe('SnapshotTabs 变更集标签族（清单 + 逐文件差异）', () => {
  it('没有变更集时标签栏只有「文件（N）」：变更集标签不凭空出现', () => {
    render(<SnapshotTabs entries={entries} />);
    expect(screen.queryByTestId('snapshot-changeset-title')).not.toBeInTheDocument();
    expect(activeTabText()).toContain('文件（2）');
  });

  it('提供变更集：多一个「变更集（N）」标签并激活，可关闭（关闭即上抛容器）', () => {
    const onCloseChangeset = vi.fn();
    render(<SnapshotTabs entries={entries} changeset={{ entry: changesetEntry }} onCloseChangeset={onCloseChangeset} />);
    expect(screen.getByTestId('snapshot-changeset-title')).toHaveTextContent('变更集（2）');
    expect(activeTabText()).toContain('变更集（2）');
    clickRemoveByTestId('snapshot-changeset-title');
    expect(onCloseChangeset).toHaveBeenCalledTimes(1);
  });

  it('清单：点文件行把路径上抛（容器据此开差异标签），R 行显示「旧 → 新」，且不重复提交主题', () => {
    const onOpenChangedFile = vi.fn();
    render(
      <SnapshotTabs entries={entries} changeset={{ entry: changesetEntry }} onOpenChangedFile={onOpenChangedFile} />,
    );
    // 用户口径：清单只承担「这次动了哪些文件」——提交主题在日志行/详情面板/标签 Tooltip 里都有，不在这里重复
    expect(screen.queryByText('带变更的提交')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('changes-file-src/a.ts'));
    expect(onOpenChangedFile).toHaveBeenCalledWith('src/a.ts');
    expect(screen.getByText('renamed.txt → old.txt')).toBeInTheDocument();
  });

  it('清单加载中/出错给占位（与旧弹窗同一套降级），加载中的标签名不带文件数', () => {
    const { unmount } = render(<SnapshotTabs entries={entries} changeset={{ loading: true }} />);
    expect(screen.getByTestId('snapshot-changeset-title')).toHaveTextContent('变更集（0）');
    expect(document.querySelector('.ant-skeleton')).toBeInTheDocument();
    unmount();
    render(<SnapshotTabs entries={entries} changeset={{ error: 'boom' }} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('容器点名的差异标签：挂载即激活，正文用差异视图（stub 编辑器）', async () => {
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        diffVersions={{ before: '旧', after: '新' }}
        diffLoader={stubLoader}
      />,
    );
    expect(screen.getByTestId('changes-diff-tab-src/a.ts')).toHaveTextContent('a.ts');
    expect(activeTabText()).toContain('a.ts');
    expect(screen.getByTestId('changes-diff-path')).toHaveTextContent('src/a.ts');
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  it('差异标签的导航：单文件变更集也渲染 1/1（两键禁用），多文件按顺序前后翻', () => {
    // 单文件：夹具换成只动一个文件的变更集
    const { unmount } = render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: { ...changesetEntry, files: [{ path: 'src/a.ts', status: 'M' }] } }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        diffLoader={stubLoader}
        onDiffTabsChange={() => {}}
      />,
    );
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByTestId('diff-prev-file')).toBeDisabled();
    expect(screen.getByTestId('diff-next-file')).toBeDisabled();
    // 「与父提交对比」那段文字已按用户口径撤掉，改由路径 Tooltip 承载
    expect(screen.queryByText('与父提交对比')).not.toBeInTheDocument();
    unmount();

    const onDiffTabsChange = vi.fn();
    const props = {
      entries,
      changeset: { entry: changesetEntry },
      diffVersions: { before: '旧', after: '新' },
      diffLoader: stubLoader,
      onDiffTabsChange,
    };
    const { rerender } = render(<SnapshotTabs {...props} diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }} />);
    // 夹具变更集 = [src/a.ts, old.txt]：当前在第一个 → 上一个禁用、下一个可用，计数 1/2
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByTestId('diff-prev-file')).toBeDisabled();
    fireEvent.click(screen.getByTestId('diff-next-file'));
    // 切下一个 = 容器把它开成差异标签并激活（与点清单行同一套 open+activate）
    expect(onDiffTabsChange).toHaveBeenCalledWith({ open: ['src/a.ts', 'old.txt'], active: 'old.txt' });
    // 容器的 open/active 回传后：新标签就位并激活（真实链路里两次 setState 同批，本组件不会先回退）
    rerender(<SnapshotTabs {...props} diffTabs={{ open: ['src/a.ts', 'old.txt'], active: 'old.txt' }} />);
    expect(screen.getByTestId('changes-diff-tab-old.txt')).toBeInTheDocument();
    expect(activeTabText()).toContain('old.txt');
    /* 组尾：下一个禁用、计数 2/2。**必须限定在激活标签页内查**——antd 把已激活过的标签页留在 DOM 里
       （只是 display:none），两个差异标签各带一组导航，全局查会命中多个。 */
    const activePanel = document.querySelector('.ant-tabs-content-active') as HTMLElement;
    expect(within(activePanel).getByText('2/2')).toBeInTheDocument();
    expect(within(activePanel).getByTestId('diff-next-file')).toBeDisabled();
  });

  it('已开差异标签跨「重挂载」由容器 props 恢复（换提交时文件标签复位、差异标签不丢）', () => {
    render(
      <SnapshotTabs
        entries={entries}
        selectedPath="README.md"
        content={contentOf('B')}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts', 'old.txt'], active: 'old.txt' }}
      />,
    );
    // 两个差异标签都在（顺序 = 容器给的顺序），激活的是容器点名的那个
    expect(screen.getByTestId('changes-diff-tab-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('changes-diff-tab-old.txt')).toBeInTheDocument();
    expect(activeTabText()).toContain('old.txt');
  });

  it('切到清单标签：把容器的差异激活项清掉（否则换提交重挂载会把人弹回差异标签）', () => {
    const onDiffTabsChange = vi.fn();
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        onDiffTabsChange={onDiffTabsChange}
      />,
    );
    fireEvent.click(screen.getByTestId('snapshot-changeset-title'));
    expect(onDiffTabsChange).toHaveBeenCalledWith({ open: ['src/a.ts'], active: '' });
    expect(activeTabText()).toContain('变更集（2）');
  });

  it('关闭差异标签：从受控列表里移除，激活项落到右邻（末位落左邻）', () => {
    const onDiffTabsChange = vi.fn();
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts', 'old.txt'], active: 'src/a.ts' }}
        onDiffTabsChange={onDiffTabsChange}
      />,
    );
    clickRemoveByTestId('changes-diff-tab-src/a.ts');
    expect(onDiffTabsChange).toHaveBeenCalledWith({ open: ['old.txt'], active: 'old.txt' });
    expect(activeTabText()).toContain('old.txt');
  });

  it('关闭最后一个差异标签：回变更集清单（激活项清空）', () => {
    const onDiffTabsChange = vi.fn();
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        onDiffTabsChange={onDiffTabsChange}
      />,
    );
    clickRemoveByTestId('changes-diff-tab-src/a.ts');
    expect(onDiffTabsChange).toHaveBeenCalledWith({ open: [], active: '' });
    expect(activeTabText()).toContain('变更集（2）');
  });

  it('容器剪掉激活的差异标签（路径不在新变更集里）：激活键兜底回变更集清单', () => {
    const { rerender } = render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
      />,
    );
    expect(activeTabText()).toContain('a.ts');
    rerender(<SnapshotTabs entries={entries} changeset={{ entry: changesetEntry }} diffTabs={{ open: [], active: '' }} />);
    expect(screen.queryByTestId('changes-diff-tab-src/a.ts')).not.toBeInTheDocument();
    expect(activeTabText()).toContain('变更集（2）');
  });

  it('根提交的差异标签只给提示行（不渲染伪 diff）', async () => {
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: { ...changesetEntry, parents: [] } }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        diffLoader={stubLoader}
      />,
    );
    expect(screen.getByTestId('changes-diff-root-hint')).toBeInTheDocument();
    expect(screen.queryByText('stub-diff-editor')).not.toBeInTheDocument();
  });

  it('R 重命名文件的差异标签只给提示行（两侧文件名不同，单文件对比会误读成全新增）', async () => {
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['old.txt'], active: 'old.txt' }}
        diffVersions={{ before: '旧', after: '新' }}
        diffLoader={stubLoader}
      />,
    );
    const hint = screen.getByTestId('changes-diff-rename-hint');
    expect(hint.textContent).toContain('renamed.txt');
    expect(hint.textContent).toContain('old.txt');
    expect(screen.queryByText('stub-diff-editor')).not.toBeInTheDocument();
  });

  it('差异拉取失败/未就绪：标签内给错误或加载占位（不空着）', () => {
    const { unmount } = render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        diffError="diff 拉取失败"
      />,
    );
    expect(screen.getByTestId('changes-diff-error')).toHaveTextContent('diff 拉取失败');
    unmount();
    render(
      <SnapshotTabs
        entries={entries}
        changeset={{ entry: changesetEntry }}
        diffTabs={{ open: ['src/a.ts'], active: 'src/a.ts' }}
        diffLoading
      />,
    );
    expect(screen.getByTestId('changes-diff-loading')).toBeInTheDocument();
  });
});
