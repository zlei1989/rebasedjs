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

  it('resetToTracked 与 onResetToTracked 同传：渲染左下按钮（含本地/上游文案），点击回调', () => {
    const onResetToTracked = vi.fn();
    render(
      <UpdateProjectDialog
        open
        {...makeHandlers()}
        resetToTracked={{ localBranch: 'main', upstream: 'origin/main' }}
        onResetToTracked={onResetToTracked}
      />,
    );
    const button = screen.getByTestId('reset-to-tracked');
    expect(button).toHaveTextContent('main → origin/main');
    fireEvent.click(button);
    expect(onResetToTracked).toHaveBeenCalledTimes(1);
  });

  it('缺省 resetToTracked/onResetToTracked：不渲染 Reset 按钮（向后兼容）', () => {
    render(<UpdateProjectDialog open {...makeHandlers()} />);
    expect(screen.queryByTestId('reset-to-tracked')).not.toBeInTheDocument();
  });

  it('resetToTracked 提供了但未传 onResetToTracked：按钮不渲染（回调为准）', () => {
    render(
      <UpdateProjectDialog open {...makeHandlers()} resetToTracked={{ localBranch: 'main', upstream: 'origin/main' }} />,
    );
    expect(screen.queryByTestId('reset-to-tracked')).not.toBeInTheDocument();
  });
});

describe('UpdateProjectDialog 更新会话结果面板（GitUpdateSession 语义）', () => {
  it('outcome 提供：渲染结果汇总（fetch 引用数 + pull 状态）；footer 变为「关闭」（确定隐藏）', () => {
    const onCancel = vi.fn();
    render(
      <UpdateProjectDialog
        open
        onOk={vi.fn()}
        onCancel={onCancel}
        outcome={{
          fetched: ['refs/remotes/origin/main', 'refs/remotes/origin/dev'],
          pull: { status: 'updated' },
        }}
      />,
    );
    const panel = screen.getByTestId('update-outcome-panel');
    expect(panel).toHaveTextContent('更新结果');
    expect(panel).toHaveTextContent('fetch 更新 2 个远程引用');
    expect(panel).toHaveTextContent('已合入当前分支');
    expect(screen.queryByRole('button', { name: /确\s*定/ })).not.toBeInTheDocument();

    // 点「关闭」→ onCancel（结果态 footer 文案）
    fireEvent.click(screen.getByRole('button', { name: /关\s*闭/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('outcome conflicts：面板提示到冲突页解决；up-to-date 提示已是最新', () => {
    const { rerender } = render(
      <UpdateProjectDialog
        open
        onOk={vi.fn()}
        onCancel={() => {}}
        outcome={{ fetched: [], pull: { status: 'conflicts' } }}
      />,
    );
    expect(screen.getByTestId('update-outcome-panel')).toHaveTextContent('更新存在冲突');
    expect(screen.getByTestId('update-outcome-panel')).toHaveTextContent('冲突页');

    rerender(
      <UpdateProjectDialog open onOk={vi.fn()} onCancel={() => {}} outcome={{ fetched: [], pull: { status: 'up-to-date' } }} />,
    );
    expect(screen.getByTestId('update-outcome-panel')).toHaveTextContent('已是最新');
  });
});
