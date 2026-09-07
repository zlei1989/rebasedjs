/**
 * WorktreePanel 测试：列表渲染（path / 分支 / head 短哈希）、「当前」Tag（currentPath 命中行绿标；
 * 缺省全不渲染）、分离 HEAD 徽标（橙「分离」，branch 为 null 时不显示分支名）、
 * 创建 Modal（路径非空 + 互斥 Radio 两模式三态校验、载荷 branch/newBranch 映射、确认即关与重开复位）、
 * 行内「移除」Popconfirm（确认后以单参 path 调 onRemove，不携带 force）、
 * 「清理」Popconfirm → onPrune、防御空态「暂无工作树」、acting 禁用、刷新按钮缺省不渲染。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorktreeEntry, WorktreeList } from '@rebased/contracts';
import { WorktreePanel, type WorktreePanelProps } from './worktree-panel';

const WT_MAIN: WorktreeEntry = { path: 'C:/repo', branch: 'main', detached: false, head: 'a'.repeat(40) };
const WT_SIDE: WorktreeEntry = { path: 'C:/repo-wt', branch: 'feat-1', detached: false, head: 'b'.repeat(40) };
const WT_DETACHED: WorktreeEntry = { path: 'C:/repo-old', branch: null, detached: true, head: 'c'.repeat(40) };

const LIST: WorktreeList = { worktrees: [WT_MAIN, WT_SIDE, WT_DETACHED] };

/** 全量 props 渲染：缺省值可被 overrides 覆盖；返回回调替身便于断言 */
function renderPanel(overrides: Partial<WorktreePanelProps> = {}) {
  const callbacks = {
    onCreate: vi.fn(),
    onRemove: vi.fn(),
    onPrune: vi.fn(),
    onRefresh: vi.fn(),
  };
  const props: WorktreePanelProps = {
    worktrees: LIST,
    currentPath: 'C:/repo',
    ...callbacks,
    ...overrides,
  };
  const view = render(<WorktreePanel {...props} />);
  return { props, callbacks, view };
}

/** 打开创建 Modal 并等待主输入出现 */
async function openCreateModal(): Promise<void> {
  fireEvent.click(screen.getByTestId('worktree-create'));
  await screen.findByTestId('worktree-create-path');
}

describe('WorktreePanel 列表', () => {
  it('行渲染 path / 分支 / head 短哈希（分离行不显示分支名）', () => {
    renderPanel();
    const main = screen.getByTestId('worktree-row-C:/repo');
    expect(main).toHaveTextContent('C:/repo');
    expect(main).toHaveTextContent('main');
    expect(main).toHaveTextContent('aaaaaaa');

    const side = screen.getByTestId('worktree-row-C:/repo-wt');
    expect(side).toHaveTextContent('feat-1');
    expect(side).toHaveTextContent('bbbbbbb');

    const detached = screen.getByTestId('worktree-row-C:/repo-old');
    expect(detached).toHaveTextContent('ccccccc');
    expect(detached).not.toHaveTextContent('null');
  });

  it('「当前」标记：currentPath 命中行绿色 Tag「当前」，未命中行不渲染', () => {
    renderPanel();
    expect(within(screen.getByTestId('worktree-row-C:/repo')).getByText('当前')).toHaveClass('ant-tag-green');
    expect(
      within(screen.getByTestId('worktree-row-C:/repo-wt')).queryByText('当前'),
    ).not.toBeInTheDocument();
  });

  it('currentPath 缺省（容器未传）时全部行不渲染「当前」', () => {
    renderPanel({ currentPath: undefined });
    expect(screen.queryByText('当前')).not.toBeInTheDocument();
  });

  it('分离 HEAD 行带橙色「分离」徽标；非分离行不渲染', () => {
    renderPanel();
    const detached = screen.getByTestId('worktree-row-C:/repo-old');
    expect(within(detached).getByText('分离')).toHaveClass('ant-tag-orange');
    expect(
      within(screen.getByTestId('worktree-row-C:/repo-wt')).queryByText('分离'),
    ).not.toBeInTheDocument();
  });
});

describe('WorktreePanel 创建 Modal', () => {
  it('三态校验：默认确定禁用；路径+所在分支齐全启用；互斥切到新建分支后新分支必填', async () => {
    renderPanel();
    await openCreateModal();
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /关联已有分支/ })).toBeChecked();

    fireEvent.change(screen.getByTestId('worktree-create-path'), { target: { value: 'C:/repo-wt' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();

    fireEvent.change(screen.getByTestId('worktree-create-branch'), { target: { value: 'feat-2' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: /创建新分支/ }));
    expect(screen.queryByTestId('worktree-create-branch')).not.toBeInTheDocument();
    expect(screen.getByTestId('worktree-create-new-branch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();

    fireEvent.change(screen.getByTestId('worktree-create-new-branch'), { target: { value: 'boom' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeEnabled();
  });

  it('路径/分支纯空白视为未填：确定禁用', async () => {
    renderPanel();
    await openCreateModal();
    fireEvent.change(screen.getByTestId('worktree-create-path'), { target: { value: '   ' } });
    fireEvent.change(screen.getByTestId('worktree-create-branch'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('确认调 onCreate：关联已有分支 → {path, branch}（trim）；确认即关；重开复位', async () => {
    const { callbacks } = renderPanel();
    await openCreateModal();
    fireEvent.change(screen.getByTestId('worktree-create-path'), { target: { value: '  C:/repo-wt  ' } });
    fireEvent.change(screen.getByTestId('worktree-create-branch'), { target: { value: '  feat-2  ' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onCreate).toHaveBeenCalledTimes(1);
    expect(callbacks.onCreate).toHaveBeenCalledWith({ path: 'C:/repo-wt', branch: 'feat-2' });

    // 确认即关：jsdom 下 rc-dialog 关闭阶段不刷 DOM，复位以重开后的默认表单代证
    await openCreateModal();
    expect(screen.getByTestId('worktree-create-path')).toHaveValue('');
    expect(screen.getByTestId('worktree-create-branch')).toHaveValue('');
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('确认调 onCreate：创建新分支 → {path, newBranch}', async () => {
    const { callbacks } = renderPanel();
    await openCreateModal();
    fireEvent.click(screen.getByRole('radio', { name: /创建新分支/ }));
    fireEvent.change(screen.getByTestId('worktree-create-path'), { target: { value: 'C:/repo-wt' } });
    fireEvent.change(screen.getByTestId('worktree-create-new-branch'), { target: { value: 'boom' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onCreate).toHaveBeenCalledTimes(1);
    expect(callbacks.onCreate).toHaveBeenCalledWith({ path: 'C:/repo-wt', newBranch: 'boom' });
  });

  it('取消后重开：输入复位、默认回到关联已有分支', async () => {
    renderPanel();
    await openCreateModal();
    fireEvent.change(screen.getByTestId('worktree-create-path'), { target: { value: 'C:/repo-wt' } });
    fireEvent.click(screen.getByRole('radio', { name: /创建新分支/ }));
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    await openCreateModal();
    expect(screen.getByTestId('worktree-create-path')).toHaveValue('');
    expect(screen.getByRole('radio', { name: /关联已有分支/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });
});

describe('WorktreePanel 行内移除', () => {
  it('「移除」Popconfirm 确认后以单参 path 调 onRemove（不携带 force）', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('worktree-remove-C:/repo-wt'));
    expect(await screen.findByText('确定移除工作树 C:/repo-wt？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onRemove).toHaveBeenCalledTimes(1);
    expect(callbacks.onRemove).toHaveBeenCalledWith('C:/repo-wt');
    expect(callbacks.onRemove.mock.calls[0]).toHaveLength(1);
  });
});

describe('WorktreePanel 清理', () => {
  it('「清理」Popconfirm 确认后调 onPrune', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('worktree-prune'));
    expect(await screen.findByText(/清理失效工作树/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onPrune).toHaveBeenCalledTimes(1);
  });
});

describe('WorktreePanel 空态与 acting', () => {
  it('空列表渲染防御空态「暂无工作树」', () => {
    renderPanel({ worktrees: { worktrees: [] } });
    expect(screen.getByText('暂无工作树')).toBeInTheDocument();
  });

  it('acting 时创建/清理/行内移除/刷新全部禁用', () => {
    renderPanel({ acting: true });
    expect(screen.getByTestId('worktree-create')).toBeDisabled();
    expect(screen.getByTestId('worktree-prune')).toBeDisabled();
    expect(screen.getByTestId('worktree-remove-C:/repo-wt')).toBeDisabled();
    expect(screen.getByTestId('worktree-refresh')).toBeDisabled();
  });

  it('点击「刷新」调 onRefresh', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('worktree-refresh'));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('onRefresh 缺省时不渲染刷新按钮', () => {
    renderPanel({ onRefresh: undefined });
    expect(screen.queryByTestId('worktree-refresh')).not.toBeInTheDocument();
  });
});
