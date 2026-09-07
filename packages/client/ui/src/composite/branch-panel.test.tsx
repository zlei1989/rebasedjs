import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BranchList, BranchRef } from '@rebased/contracts';
import { BranchPanel } from './branch-panel';

/** 测试分支工厂：补全 BranchRef 必填字段，默认本地、非当前、已合并 */
function makeBranch(partial: Partial<BranchRef> & { name: string }): BranchRef {
  return {
    remote: false,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    hash: 'abc123',
    mergedIntoHead: true,
    lastCommitIso: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

/** 测试列表工厂 */
function makeList(branches: BranchRef[]): BranchList {
  return { branches };
}

/** 测试回调工厂：全部 vi.fn() */
function makeHandlers() {
  return { onAction: vi.fn(), onCheckout: vi.fn() };
}

/** 打开本地行的操作下拉菜单（Dropdown trigger 为 click） */
async function openLocalMenu(name: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`menu-local-${name}`));
  await screen.findByText('删除');
}

describe('BranchPanel 分组渲染', () => {
  it('本地/远程两组卡片标题带计数', () => {
    render(
      <BranchPanel
        branches={makeList([
          makeBranch({ name: 'main', current: true }),
          makeBranch({ name: 'feature' }),
          makeBranch({ name: 'origin/main', remote: true }),
        ])}
        {...makeHandlers()}
      />,
    );
    expect(screen.getByText('本地分支（2）')).toBeInTheDocument();
    expect(screen.getByText('远程分支（1）')).toBeInTheDocument();
  });

  it('current 分支行带"当前"标记', () => {
    render(
      <BranchPanel
        branches={makeList([makeBranch({ name: 'main', current: true }), makeBranch({ name: 'dev' })])}
        {...makeHandlers()}
      />,
    );
    expect(screen.getByTestId('row-local-main')).toHaveTextContent('当前');
    expect(screen.getByTestId('row-local-dev')).not.toHaveTextContent('当前');
  });

  it('mergedIntoHead=true 的行显示已合并图标，false 不显示', () => {
    render(
      <BranchPanel
        branches={makeList([
          makeBranch({ name: 'merged-b', mergedIntoHead: true }),
          makeBranch({ name: 'unmerged-b', mergedIntoHead: false }),
        ])}
        {...makeHandlers()}
      />,
    );
    expect(screen.getByTestId('merged-icon-merged-b')).toBeInTheDocument();
    expect(screen.queryByTestId('merged-icon-unmerged-b')).not.toBeInTheDocument();
  });

  it('上游徽标：ahead/behind 为 0 时隐藏对应箭头，非 0 显示', () => {
    render(
      <BranchPanel
        branches={makeList([
          makeBranch({ name: 'a', upstream: 'origin/a', ahead: 2, behind: 0 }),
          makeBranch({ name: 'b', upstream: 'origin/b', ahead: 0, behind: 3 }),
        ])}
        {...makeHandlers()}
      />,
    );
    const rowA = screen.getByTestId('row-local-a');
    expect(rowA).toHaveTextContent('↑2');
    expect(rowA).not.toHaveTextContent('↓');
    const rowB = screen.getByTestId('row-local-b');
    expect(rowB).toHaveTextContent('↓3');
    expect(rowB).not.toHaveTextContent('↑');
  });

  it('远程行只读：无操作菜单按钮', () => {
    render(
      <BranchPanel
        branches={makeList([makeBranch({ name: 'origin/main', remote: true })])}
        {...makeHandlers()}
      />,
    );
    expect(screen.getByTestId('row-remote-origin/main')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-remote-origin/main')).not.toBeInTheDocument();
  });
});

describe('BranchPanel 新建分支 Modal', () => {
  it('不勾"创建后检出"：以 {action:"create",name} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<BranchPanel branches={makeList([])} {...makeHandlers()} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('create-branch-button'));
    fireEvent.change(await screen.findByTestId('create-name'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'create', name: 'b1' });
  });

  it('勾选"创建后检出"：以 {action:"newBranch",name} 调 onCheckout', async () => {
    const onAction = vi.fn();
    const onCheckout = vi.fn();
    render(
      <BranchPanel branches={makeList([])} onAction={onAction} onCheckout={onCheckout} />,
    );
    fireEvent.click(screen.getByTestId('create-branch-button'));
    fireEvent.change(await screen.findByTestId('create-name'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '创建后检出' }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCheckout).toHaveBeenCalledTimes(1);
    expect(onCheckout).toHaveBeenCalledWith({ action: 'newBranch', name: 'b1' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('填写起始点时 action 携带 startPoint', async () => {
    const onAction = vi.fn();
    render(<BranchPanel branches={makeList([])} {...makeHandlers()} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('create-branch-button'));
    fireEvent.change(await screen.findByTestId('create-name'), { target: { value: 'b1' } });
    fireEvent.change(screen.getByTestId('create-start-point'), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledWith({ action: 'create', name: 'b1', startPoint: 'main' });
  });
});

describe('BranchPanel 行操作', () => {
  it('菜单"检出"：以 {action:"branch",name} 调 onCheckout', async () => {
    const onCheckout = vi.fn();
    render(
      <BranchPanel branches={makeList([makeBranch({ name: 'dev' })])} {...makeHandlers()} onCheckout={onCheckout} />,
    );
    await openLocalMenu('dev');
    fireEvent.click(screen.getByText('检出'));
    expect(onCheckout).toHaveBeenCalledTimes(1);
    expect(onCheckout).toHaveBeenCalledWith({ action: 'branch', name: 'dev' });
  });

  it('删除未合并分支：Popconfirm 提示强制删除，确认后传 force:true', async () => {
    const onAction = vi.fn();
    render(
      <BranchPanel
        branches={makeList([makeBranch({ name: 'x', mergedIntoHead: false })])}
        {...makeHandlers()}
        onAction={onAction}
      />,
    );
    await openLocalMenu('x');
    fireEvent.click(screen.getByText('删除'));
    expect(await screen.findByText(/该分支未合并，删除将使用强制删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'delete', name: 'x', force: true });
  });

  it('删除已合并分支：确认后不带 force', async () => {
    const onAction = vi.fn();
    render(
      <BranchPanel
        branches={makeList([makeBranch({ name: 'x', mergedIntoHead: true })])}
        {...makeHandlers()}
        onAction={onAction}
      />,
    );
    await openLocalMenu('x');
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledWith({ action: 'delete', name: 'x' });
  });

  it('当前分支的"删除"菜单项禁用', async () => {
    render(
      <BranchPanel
        branches={makeList([makeBranch({ name: 'main', current: true })])}
        {...makeHandlers()}
      />,
    );
    fireEvent.click(screen.getByTestId('menu-local-main'));
    const deleteItem = await screen.findByText('删除');
    expect(deleteItem.closest('li')).toHaveClass('ant-dropdown-menu-item-disabled');
  });

  it('菜单"重命名"：Modal 输入新名后以 {action:"rename",oldName,newName} 调 onAction', async () => {
    const onAction = vi.fn();
    render(
      <BranchPanel branches={makeList([makeBranch({ name: 'old' })])} {...makeHandlers()} onAction={onAction} />,
    );
    await openLocalMenu('old');
    fireEvent.click(screen.getByText('重命名'));
    fireEvent.change(await screen.findByTestId('rename-input'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'rename', oldName: 'old', newName: 'new' });
  });

  it('菜单"设上游"：Modal 输入上游后以 {action:"setUpstream",name,upstream} 调 onAction', async () => {
    const onAction = vi.fn();
    render(
      <BranchPanel branches={makeList([makeBranch({ name: 'dev' })])} {...makeHandlers()} onAction={onAction} />,
    );
    await openLocalMenu('dev');
    fireEvent.click(screen.getByText('设上游'));
    fireEvent.change(await screen.findByTestId('upstream-input'), { target: { value: 'origin/dev' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'setUpstream', name: 'dev', upstream: 'origin/dev' });
  });
});

describe('BranchPanel 过滤/查找已合并', () => {
  const LIST = makeList([
    makeBranch({ name: 'main', current: true }),
    makeBranch({ name: 'feature-merged', mergedIntoHead: true }),
    makeBranch({ name: 'feature-old', mergedIntoHead: false }),
    makeBranch({ name: 'origin/main', remote: true, mergedIntoHead: true }),
  ]);

  it('文本过滤：大小写不敏感子串匹配（两组同筛），计数带「匹配/总数」', () => {
    render(<BranchPanel branches={LIST} {...makeHandlers()} />);
    fireEvent.change(screen.getByTestId('branch-filter'), { target: { value: 'FEATURE' } });
    expect(screen.getByTestId('row-local-feature-merged')).toBeInTheDocument();
    expect(screen.getByTestId('row-local-feature-old')).toBeInTheDocument();
    expect(screen.queryByTestId('row-local-main')).not.toBeInTheDocument();
    expect(screen.getByText('本地分支（2/3）')).toBeInTheDocument();
    expect(screen.getByText('远程分支（0/1）')).toBeInTheDocument();
  });

  it('「仅看已合并」：只保留 mergedIntoHead=true 的条目（含远程）', () => {
    render(<BranchPanel branches={LIST} {...makeHandlers()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /仅看已合并/ }));
    expect(screen.getByTestId('row-local-main')).toBeInTheDocument();
    expect(screen.getByTestId('row-local-feature-merged')).toBeInTheDocument();
    expect(screen.queryByTestId('row-local-feature-old')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-remote-origin/main')).toBeInTheDocument();
  });

  it('清理按钮仅显示可选目标计数（已合并且非当前本地分支），确认后回调', async () => {
    const onCleanupMerged = vi.fn();
    render(<BranchPanel branches={LIST} {...makeHandlers()} onCleanupMerged={onCleanupMerged} />);
    const button = screen.getByTestId('cleanup-merged');
    expect(button).toHaveTextContent('清理已合并（1）'); // feature-merged；main current 不计
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onCleanupMerged).toHaveBeenCalledTimes(1);
  });

  it('未传 onCleanupMerged 时不渲染清理按钮', () => {
    render(<BranchPanel branches={LIST} {...makeHandlers()} />);
    expect(screen.queryByTestId('cleanup-merged')).not.toBeInTheDocument();
  });
});
