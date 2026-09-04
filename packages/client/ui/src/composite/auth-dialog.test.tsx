import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthDialog } from './auth-dialog';

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

/** 填好 account 与 token */
function fillCredentials(account: string, token: string): void {
  fireEvent.change(screen.getByTestId('auth-account'), { target: { value: account } });
  fireEvent.change(screen.getByTestId('auth-token'), { target: { value: token } });
}

describe('AuthDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<AuthDialog open={false} host="github.com" {...makeHandlers()} />);
    expect(screen.queryByText('保存并重试')).not.toBeInTheDocument();
  });

  it('host 只读展示', () => {
    render(<AuthDialog open host="github.com" {...makeHandlers()} />);
    expect(screen.getByTestId('auth-host')).toHaveTextContent('github.com');
  });

  it('account 或 token 为空时「保存并重试」禁用', () => {
    render(<AuthDialog open host="github.com" {...makeHandlers()} />);
    const ok = screen.getByRole('button', { name: '保存并重试' });
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByTestId('auth-account'), { target: { value: 'user' } });
    expect(ok).toBeDisabled();
    fillCredentials('', 'tok');
    expect(ok).toBeDisabled();
  });

  it('填写 account+token 后点「保存并重试」：以 (account, token) 调 onOk', () => {
    const { onOk } = makeHandlers();
    render(<AuthDialog open host="github.com" onOk={onOk} onCancel={() => {}} />);
    fillCredentials('user', 'tok');
    fireEvent.click(screen.getByRole('button', { name: '保存并重试' }));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith('user', 'tok');
  });

  it('点取消触发 onCancel 且不触发 onOk（取消即放弃操作）', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<AuthDialog open host="github.com" onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });
});
