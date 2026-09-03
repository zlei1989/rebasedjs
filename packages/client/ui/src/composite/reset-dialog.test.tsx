import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResetDialog } from './reset-dialog';

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

describe('ResetDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<ResetDialog open={false} ref="HEAD~1" {...makeHandlers()} />);
    expect(screen.queryByText('重置到')).not.toBeInTheDocument();
  });

  it('默认选中 mixed（保留工作区、重置暂存区）', () => {
    render(<ResetDialog open ref="HEAD~1" {...makeHandlers()} />);
    expect(screen.getByRole('radio', { name: /保留工作区、重置暂存区/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /保留暂存区与工作区/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /丢弃暂存区与工作区全部改动/ })).not.toBeChecked();
  });

  it('展示目标 ref（refLabel 优先，缺省展示 ref 原文）', () => {
    const { unmount } = render(
      <ResetDialog open ref="abc123def456" refLabel="abc123d 修复登录" {...makeHandlers()} />,
    );
    expect(screen.getByText('abc123d 修复登录')).toBeInTheDocument();
    unmount();
    render(<ResetDialog open ref="HEAD~2" {...makeHandlers()} />);
    expect(screen.getByText('HEAD~2')).toBeInTheDocument();
  });

  it('默认 mixed 下点确定传出 {ref, mode: "mixed"}', () => {
    const { onOk } = makeHandlers();
    render(<ResetDialog open ref="HEAD~1" onOk={onOk} onCancel={() => {}} />);
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ ref: 'HEAD~1', mode: 'mixed' });
  });

  it('选 soft 后点确定传出 {ref, mode: "soft"}', () => {
    const { onOk } = makeHandlers();
    render(<ResetDialog open ref="abc123" onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /保留暂存区与工作区/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ ref: 'abc123', mode: 'soft' });
  });

  it('选 hard 未勾选确认时确定禁用，勾选后放行并传出 mode: "hard"', () => {
    const { onOk } = makeHandlers();
    render(<ResetDialog open ref="abc123" onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /丢弃暂存区与工作区全部改动/ }));
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    expect(onOk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我了解 hard 将丢弃未提交改动/ }));
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ ref: 'abc123', mode: 'hard' });
  });

  it('非 hard 模式不渲染确认 Checkbox', () => {
    render(<ResetDialog open ref="abc123" {...makeHandlers()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('点取消触发 onCancel 且不触发 onOk', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<ResetDialog open ref="abc123" onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('confirming 时确定按钮进入 loading 态', () => {
    render(<ResetDialog open ref="abc123" confirming {...makeHandlers()} />);
    expect(screen.getByRole('button', { name: /确\s*定/ })).toHaveClass('ant-btn-loading');
  });
});
