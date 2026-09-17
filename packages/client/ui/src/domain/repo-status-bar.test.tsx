import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RepoStatus } from '@rebased/contracts';
import { RepoStatusBar } from './repo-status-bar';

/** 测试状态工厂：补全 RepoStatus 必填字段，按需覆盖 */
function makeStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return { branch: 'main', upstream: 'origin/main', headHash: 'a'.repeat(40), ahead: 0, behind: 0, entries: [], ...overrides };
}

describe('RepoStatusBar', () => {
  it('渲染分支名', () => {
    render(<RepoStatusBar status={makeStatus({ branch: 'main' })} />);
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('ahead/behind 非零时渲染「圆点 + 箭头计数」：incoming 蓝点 + ↓2、outgoing 绿点 + ↑3', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 3, behind: 2 })} />);
    const incoming = screen.getByTestId('incoming');
    const outgoing = screen.getByTestId('outgoing');
    // 走 antd Badge 语义色（原手搓 span + 硬编码 #389FD6/#59A869）：色类落在内层圆点上，尺寸由组件给
    expect(incoming.querySelector('.ant-badge-status-dot')).toHaveClass('ant-badge-color-blue');
    expect(outgoing.querySelector('.ant-badge-status-dot')).toHaveClass('ant-badge-color-green');
    // 计数从 tooltip 抬到明面：behind 配下箭头、ahead 配上箭头，且不再只存在于 tooltip 里
    expect(within(incoming).getByText('2')).toBeInTheDocument();
    expect(within(outgoing).getByText('3')).toBeInTheDocument();
    // 按 icon 类断言（antd 渲染成 `aria-label="arrow-down" aria-hidden`，按属性序选择器易碎）
    expect(incoming.querySelector('.anticon-arrow-down')).not.toBeNull();
    expect(outgoing.querySelector('.anticon-arrow-up')).not.toBeNull();
  });

  it('计数带读屏口径：数字的 aria-label 说明本地/远端领先，箭头装饰性隐藏', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 3, behind: 2 })} />);
    expect(screen.getByLabelText('本地领先 3 个提交（outgoing，尚未推到远端）')).toHaveTextContent('3');
    expect(screen.getByLabelText('远端领先 2 个提交（incoming，尚未拉到本地）')).toHaveTextContent('2');
    // 箭头对读屏隐藏（包裹 span 上挂了 aria-hidden，图标自身也带）：断言挂在图标上，确认这层没被摘掉
    expect(screen.getByTestId('outgoing').querySelector('.anticon-arrow-up')).toHaveAttribute('aria-hidden', 'true');
  });

  it('仅 behind 非零（远端领先、本地未推送）时只渲染蓝色 ↓N，不出现上箭头', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 0, behind: 5 })} />);
    const incoming = screen.getByTestId('incoming');
    expect(within(incoming).getByText('5')).toBeInTheDocument();
    expect(incoming.querySelector('.ant-badge-status-dot')).toHaveClass('ant-badge-color-blue');
    expect(incoming.querySelector('.anticon-arrow-down')).not.toBeNull();
    // 0 的那侧整组不渲染：既没有绿点圆点，也没有 ↑0 的占位
    expect(screen.queryByTestId('outgoing')).not.toBeInTheDocument();
    expect(document.querySelector('.anticon-arrow-up')).toBeNull();
  });

  it('徽标 tooltip 文本为 "N incoming and M outgoing commits"', async () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 3, behind: 2 })} />);
    fireEvent.mouseEnter(screen.getByTestId('inout-badges'));
    expect(await screen.findByText('2 incoming and 3 outgoing commits')).toBeInTheDocument();
  });

  it('ahead/behind 全零不渲染徽标', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 0, behind: 0 })} />);
    expect(screen.queryByTestId('incoming')).not.toBeInTheDocument();
    expect(screen.queryByTestId('outgoing')).not.toBeInTheDocument();
  });

  it('仅 ahead 非零时只渲染绿色 ↑1，不出现下箭头', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 1, behind: 0 })} />);
    const outgoing = screen.getByTestId('outgoing');
    expect(outgoing.querySelector('.ant-badge-status-dot')).toHaveClass('ant-badge-color-green');
    expect(within(outgoing).getByText('1')).toBeInTheDocument();
    expect(screen.queryByTestId('incoming')).not.toBeInTheDocument();
    expect(document.querySelector('.anticon-arrow-down')).toBeNull();
  });

  it('分离头指针时显示占位文本', () => {
    render(<RepoStatusBar status={makeStatus({ branch: null })} />);
    expect(screen.getByText(/detached/i)).toBeInTheDocument();
  });

  it('点分支 chip 把分支名写进剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RepoStatusBar status={makeStatus({ branch: 'feat/multi-protocol-inbound-p0' })} />);
    fireEvent.click(screen.getByTestId('status-branch-chip'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('feat/multi-protocol-inbound-p0'));
  });

  it('分离头指针时不把占位文案做成复制目标（复制的是一句占位，粘出去没有意义）', () => {
    render(<RepoStatusBar status={makeStatus({ branch: null })} />);
    // chip 仍渲染，但它不是可点复制的按钮
    expect(screen.getByTestId('status-branch-chip').tagName).toBe('SPAN');
  });
});
