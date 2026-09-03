import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StashEntry, StashList } from '@rebased/contracts';
import { StashPanel } from './stash-panel';

/** 测试贮藏条目工厂：补全 StashEntry 必填字段 */
function makeStash(partial: Partial<StashEntry> & { index: number }): StashEntry {
  return {
    hash: `hash${partial.index}`,
    message: `stash message ${partial.index}`,
    dateIso: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

/** 测试列表工厂 */
function makeList(stashes: StashEntry[]): StashList {
  return { stashes };
}

describe('StashPanel 空态与渲染', () => {
  it('无贮藏时列表卡渲染 EmptyState', () => {
    render(<StashPanel stashes={makeList([])} onAction={vi.fn()} />);
    expect(screen.getByText('暂无贮藏')).toBeInTheDocument();
  });

  it('行渲染 stash@{index} 徽标与 message', () => {
    render(
      <StashPanel stashes={makeList([makeStash({ index: 0, message: 'wip: fix' })])} onAction={vi.fn()} />,
    );
    const row = screen.getByTestId('row-stash-0');
    expect(row).toHaveTextContent('stash@{0}');
    expect(row).toHaveTextContent('wip: fix');
  });
});

describe('StashPanel 保存表单', () => {
  it('提交：以 {action:"save",message,includeUntracked} 调 onAction', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([])} onAction={onAction} />);
    fireEvent.change(screen.getByTestId('stash-message-input'), { target: { value: 'wip: save' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '包含未跟踪文件' }));
    fireEvent.click(screen.getByTestId('stash-save-button'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      action: 'save',
      message: 'wip: save',
      includeUntracked: true,
    });
  });

  it('未勾选时 includeUntracked 为 false，提交后表单复位', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([])} onAction={onAction} />);
    const input = screen.getByTestId('stash-message-input');
    fireEvent.change(input, { target: { value: 'msg' } });
    fireEvent.click(screen.getByTestId('stash-save-button'));
    expect(onAction).toHaveBeenCalledWith({ action: 'save', message: 'msg', includeUntracked: false });
    expect(input).toHaveValue('');
  });
});

describe('StashPanel 行操作', () => {
  it('"应用"：直接以 {action:"apply",index} 调 onAction', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 1 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('apply-stash-1'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'apply', index: 1 });
  });

  it('"弹出"：Popconfirm 确认后以 {action:"pop",index} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 0 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('pop-stash-0'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'pop', index: 0 });
  });

  it('"删除"：Popconfirm 确认后以 {action:"drop",index} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 2 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('drop-stash-2'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'drop', index: 2 });
  });

  it('"转分支"：Modal 输入分支名后以 {action:"branch",index,name} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 0 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('branch-stash-0'));
    fireEvent.change(await screen.findByTestId('stash-branch-name-input'), {
      target: { value: 'from-stash' },
    });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'branch', index: 0, name: 'from-stash' });
  });
});
