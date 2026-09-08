import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateProjectDialog } from './update-project-dialog';

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

describe('UpdateProjectDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<UpdateProjectDialog open={false} {...makeHandlers()} />);
    expect(screen.queryByText('更新项目')).not.toBeInTheDocument();
  });

  it('默认选中 merge 策略', () => {
    render(<UpdateProjectDialog open {...makeHandlers()} />);
    expect(screen.getByRole('radio', { name: /merge/ })).toBeChecked();
  });

  it('直接确定：传出 {strategy:"merge"}', () => {
    const { onOk } = makeHandlers();
    render(<UpdateProjectDialog open onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith({ strategy: 'merge' });
  });

  it('改选 rebase 后确定：传出 {strategy:"rebase"}', () => {
    const { onOk } = makeHandlers();
    render(<UpdateProjectDialog open onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /rebase/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ strategy: 'rebase' });
  });

  it('点取消触发 onCancel 且不触发 onOk', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<UpdateProjectDialog open onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('pushRejected=true：标题与说明文案转为推送被拒场景（GitRejectedPushUpdateDialog 语义）', () => {
    render(<UpdateProjectDialog open pushRejected {...makeHandlers()} />);
    expect(screen.getByText('推送被拒 — 更新项目')).toBeInTheDocument();
    expect(screen.getByText(/远端有更新，请先拉取最新提交/)).toBeInTheDocument();
    expect(screen.queryByText('更新项目')).not.toBeInTheDocument();
  });

  it('pushRejected 缺省（普通更新）：标题与说明文案保持原样', () => {
    render(<UpdateProjectDialog open {...makeHandlers()} />);
    expect(screen.getByText('更新项目')).toBeInTheDocument();
    expect(screen.getByText(/更新方式（fetch 全部远程后合入当前分支）/)).toBeInTheDocument();
  });
});
