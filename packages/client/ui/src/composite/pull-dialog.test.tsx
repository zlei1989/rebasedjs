import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteList } from '@rebased/contracts';
import { PullDialog } from './pull-dialog';

const REMOTES: RemoteList = {
  remotes: [
    { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
    { name: 'upstream', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
  ],
};

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

describe('PullDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<PullDialog open={false} remotes={REMOTES} {...makeHandlers()} />);
    expect(screen.queryByText('拉取')).not.toBeInTheDocument();
  });

  it('默认选中 origin，rebase 未勾选', () => {
    render(<PullDialog open remotes={REMOTES} {...makeHandlers()} />);
    expect(screen.getByTestId('pull-remote-select')).toHaveTextContent('origin');
    expect(screen.getByRole('checkbox', { name: '使用 rebase 而非 merge' })).not.toBeChecked();
  });

  it('默认提交：{remote}（rebase 未勾不携带）', () => {
    const { onOk } = makeHandlers();
    render(<PullDialog open remotes={REMOTES} onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith({ remote: 'origin' });
  });

  it('勾选 rebase 后提交：载荷携带 rebase:true', () => {
    const { onOk } = makeHandlers();
    render(<PullDialog open remotes={REMOTES} onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '使用 rebase 而非 merge' }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ remote: 'origin', rebase: true });
  });

  it('点取消触发 onCancel 且不触发 onOk', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<PullDialog open remotes={REMOTES} onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });
});
