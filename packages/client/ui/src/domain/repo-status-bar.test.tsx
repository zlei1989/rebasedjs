import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@rebased/contracts';
import { RepoStatusBar } from './repo-status-bar';

/** 测试状态工厂：补全 RepoStatus 必填字段，按需覆盖 */
function makeStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, entries: [], ...overrides };
}

describe('RepoStatusBar', () => {
  it('渲染分支名', () => {
    render(<RepoStatusBar status={makeStatus({ branch: 'main' })} />);
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('ahead/behind 非零时渲染 incoming/outgoing 圆点徽标（蓝/绿）', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 3, behind: 2 })} />);
    const incoming = screen.getByTestId('incoming');
    const outgoing = screen.getByTestId('outgoing');
    expect(incoming).toHaveStyle({ backgroundColor: '#389FD6' });
    expect(outgoing).toHaveStyle({ backgroundColor: '#59A869' });
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

  it('仅 ahead 非零时只渲染 outgoing 徽标', () => {
    render(<RepoStatusBar status={makeStatus({ ahead: 1, behind: 0 })} />);
    expect(screen.queryByTestId('incoming')).not.toBeInTheDocument();
    expect(screen.getByTestId('outgoing')).toBeInTheDocument();
  });

  it('分离头指针时显示占位文本', () => {
    render(<RepoStatusBar status={makeStatus({ branch: null })} />);
    expect(screen.getByText(/detached/i)).toBeInTheDocument();
  });
});
