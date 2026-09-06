/**
 * ShelfPanel 测试：列表渲染（name / formatCommitDate 时间 / "N 个未跟踪"）、空态、
 * 保存 Modal（name 必填，提交 {action:"save",name}；取消后重开复位）、
 * 恢复与删除均经 Popconfirm 确认后以对应 action 回调。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShelfEntry, ShelfList } from '@rebased/contracts';
import { ShelfPanel } from './shelf-panel';

/** 测试搁置条目工厂：补全 ShelfEntry 必填字段 */
function makeShelf(partial: Partial<ShelfEntry> & { name: string }): ShelfEntry {
  return { createdAtIso: '2026-08-01T10:30:00+08:00', untrackedCount: 3, ...partial };
}

/** 测试列表工厂 */
function makeList(shelves: ShelfEntry[]): ShelfList {
  return { shelves };
}

describe('ShelfPanel 列表渲染', () => {
  it('行渲染 name、创建时间与未跟踪数', () => {
    render(
      <ShelfPanel
        shelves={makeList([
          makeShelf({ name: 'wip', untrackedCount: 3 }),
          makeShelf({ name: 'demo', untrackedCount: 0, createdAtIso: '2026-08-02T09:00:00+08:00' }),
        ])}
        onAction={() => {}}
      />,
    );
    const row = screen.getByTestId('row-shelf-wip');
    expect(row).toHaveTextContent('wip');
    expect(row).toHaveTextContent('2026-08-01 10:30');
    expect(row).toHaveTextContent('3 个未跟踪');
    expect(screen.getByTestId('row-shelf-demo')).toHaveTextContent('0 个未跟踪');
  });

  it('无搁置时渲染空态', () => {
    render(<ShelfPanel shelves={makeList([])} onAction={() => {}} />);
    expect(screen.getByText('暂无搁置')).toBeInTheDocument();
  });
});

describe('ShelfPanel 保存 Modal', () => {
  it('填名称提交：{action:"save", name}', async () => {
    const onAction = vi.fn();
    render(<ShelfPanel shelves={makeList([])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('shelf-save-button'));
    fireEvent.change(await screen.findByTestId('shelf-save-name'), { target: { value: 'wip' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'save', name: 'wip' });
  });

  it('名称为空时确定按钮禁用', async () => {
    render(<ShelfPanel shelves={makeList([])} onAction={() => {}} />);
    fireEvent.click(screen.getByTestId('shelf-save-button'));
    expect(await screen.findByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('取消后重开：输入已复位', async () => {
    const onAction = vi.fn();
    render(<ShelfPanel shelves={makeList([])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('shelf-save-button'));
    fireEvent.change(await screen.findByTestId('shelf-save-name'), { target: { value: 'wip' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(screen.getByTestId('shelf-save-button'));
    expect(await screen.findByTestId('shelf-save-name')).toHaveValue('');
  });
});

describe('ShelfPanel 行操作', () => {
  it('「恢复」：Popconfirm 确认后以 {action:"restore", name} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<ShelfPanel shelves={makeList([makeShelf({ name: 'wip' })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('restore-shelf-wip'));
    expect(await screen.findByText(/确定恢复搁置 wip/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'restore', name: 'wip' });
  });

  it('「删除」：Popconfirm 确认后以 {action:"drop", name} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<ShelfPanel shelves={makeList([makeShelf({ name: 'wip' })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('delete-shelf-wip'));
    expect(await screen.findByText(/确定删除搁置 wip/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'drop', name: 'wip' });
  });

  it('acting 时行内恢复/删除按钮禁用', () => {
    render(<ShelfPanel shelves={makeList([makeShelf({ name: 'wip' })])} onAction={() => {}} acting />);
    expect(screen.getByTestId('restore-shelf-wip')).toBeDisabled();
    expect(screen.getByTestId('delete-shelf-wip')).toBeDisabled();
  });
});
