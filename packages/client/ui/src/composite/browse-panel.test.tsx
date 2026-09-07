import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrowseEntry } from '@rebased/contracts';
import { BrowsePanel } from './browse-panel';

/** 测试条目工厂：补全 BrowseEntry 必填字段 */
function entry(partial: Partial<BrowseEntry> & { path: string }): BrowseEntry {
  return { mode: '100644', type: 'blob', hash: 'h', ...partial };
}

const ENTRIES: BrowseEntry[] = [
  entry({ path: 'A.txt' }),
  entry({ path: 'src/index.ts' }),
  entry({ path: 'src/lib' }),
  entry({ path: 'sub/mod', type: 'commit', mode: '160000' }),
];

describe('BrowsePanel 渲染', () => {
  it('回显 rev、渲染文件数与树节点（目录聚合 + 徽标）', () => {
    render(<BrowsePanel rev="deadbeef" entries={ENTRIES} />);

    expect(screen.getByTestId('browse-rev')).toHaveTextContent('deadbeef');
    expect(screen.getByText('文件（4）')).toBeInTheDocument();
    // 根级：目录 src 与文件 A.txt、sub（约定目录在前）
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('A.txt')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(screen.getByText('子模块')).toBeInTheDocument();
  });

  it('未选择文件时内容区显示空态', () => {
    render(<BrowsePanel rev="deadbeef" entries={ENTRIES} />);
    expect(screen.getByText('在左侧选择文件查看内容')).toBeInTheDocument();
  });

  it('空版本显示空态', () => {
    render(<BrowsePanel rev="deadbeef" entries={[]} />);
    expect(screen.getByText('该版本没有文件')).toBeInTheDocument();
  });

  it('loading/error 态', () => {
    const { unmount } = render(<BrowsePanel rev="deadbeef" loading />);
    expect(screen.getByTestId('browse-loading')).toBeInTheDocument();
    unmount();
    render(<BrowsePanel rev="deadbeef" error="加载失败" />);
    expect(screen.getByTestId('browse-error')).toHaveTextContent('加载失败');
  });
});

describe('BrowsePanel 内容视图', () => {
  it('选中文件后渲染只读内容 + 路径标题', () => {
    render(
      <BrowsePanel
        rev="deadbeef"
        entries={ENTRIES}
        selectedPath="src/index.ts"
        content={{ content: 'const a = 1;\n', binary: false }}
      />,
    );
    expect(screen.getByTestId('browse-content')).toHaveTextContent('const a = 1;');
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
  });

  it('二进制文件仅提示不渲染内容', () => {
    render(
      <BrowsePanel
        rev="deadbeef"
        entries={ENTRIES}
        selectedPath="img.bin"
        content={{ content: 'PNG\u0000\u0001', binary: true }}
      />,
    );
    expect(screen.getByTestId('browse-binary')).toHaveTextContent('二进制文件');
    expect(screen.queryByTestId('browse-content')).not.toBeInTheDocument();
  });

  it('内容加载错误透传', () => {
    render(<BrowsePanel rev="deadbeef" entries={ENTRIES} selectedPath="A.txt" contentError="文件不存在于该版本" />);
    expect(screen.getByTestId('browse-content-error')).toHaveTextContent('文件不存在于该版本');
  });
});

describe('BrowsePanel 交互', () => {
  it('点击叶子文件以完整路径调 onSelectFile', () => {
    const onSelectFile = vi.fn();
    render(<BrowsePanel rev="deadbeef" entries={ENTRIES} onSelectFile={onSelectFile} />);

    // 树节点按角色 treeitem 渲染（antd）；点击 A.txt 叶子（作用于标题节点，事件冒泡到节点行）
    fireEvent.click(screen.getByText('A.txt'));

    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith('A.txt');
  });

  it('点击目录行不触发文件选择（展开/收起语义）', () => {
    const onSelectFile = vi.fn();
    render(<BrowsePanel rev="deadbeef" entries={ENTRIES} onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByText('src'));

    expect(onSelectFile).not.toHaveBeenCalled();
  });
});
