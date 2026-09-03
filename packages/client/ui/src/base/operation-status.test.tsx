import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationStatus } from './operation-status';

describe('OperationStatus', () => {
  it('merge 状态显示"合并中"，点中止经确认后触发 onAbort', async () => {
    const onAbort = vi.fn();
    render(<OperationStatus operation={{ kind: 'merge' }} onAbort={onAbort} />);
    expect(screen.getByText('合并中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /中\s*止/ }));
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('rebase 显示进度（第 step/total 步）；none 不渲染', () => {
    render(<OperationStatus operation={{ kind: 'rebase', step: 2, total: 5 }} onAbort={() => {}} />);
    expect(screen.getByText('变基中（第 2/5 步）')).toBeInTheDocument();
    const { container } = render(<OperationStatus operation={{ kind: 'none' }} onAbort={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('cherry-pick 显示"拣选中"，revert 显示"还原中"', () => {
    const { unmount } = render(<OperationStatus operation={{ kind: 'cherry-pick' }} onAbort={() => {}} />);
    expect(screen.getByText('拣选中')).toBeInTheDocument();
    unmount();
    render(<OperationStatus operation={{ kind: 'revert' }} onAbort={() => {}} />);
    expect(screen.getByText('还原中')).toBeInTheDocument();
  });

  it('aborting 时中止按钮进入 loading 态', () => {
    render(<OperationStatus operation={{ kind: 'merge' }} onAbort={() => {}} aborting />);
    expect(screen.getByRole('button', { name: /中\s*止/ })).toHaveClass('ant-btn-loading');
  });
});
