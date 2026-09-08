/**
 * ConsolePanel 测试：列表渲染（时间 + args 单行 + 退出码徽标 0 绿/非 0 红 + 耗时 ms/s）、
 * stderrTail 小字（空则省略）、空态、loading Spin、刷新回调（缺省不渲染）。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleEntry } from '@rebased/contracts';
import { ConsolePanel, foldArgs } from './console-panel';

const ENTRIES: ConsoleEntry[] = [
  { id: 1, args: ['git', 'add', 'a.ts'], exitCode: 0, durationMs: 320, stderrTail: '', atIso: '2026-08-01T10:30:00+08:00' },
  { id: 2, args: ['git', 'commit', '-m', 'x'], exitCode: 1, durationMs: 1520, stderrTail: 'error: pathspec x did not match', atIso: '2026-08-01T10:31:00+08:00' },
  { id: 3, args: ['git', 'fetch'], exitCode: -1, durationMs: 12, stderrTail: 'spawn git ENOENT', atIso: '2026-08-01T10:32:00+08:00' },
];

describe('ConsolePanel', () => {
  it('渲染每条记录：时间 + args 单行 + 退出码徽标 + 耗时', () => {
    render(<ConsolePanel entries={ENTRIES} />);
    const row = screen.getByTestId('console-row-1');
    expect(within(row).getByText('2026-08-01 10:30')).toBeInTheDocument();
    expect(within(row).getByText('git add a.ts')).toBeInTheDocument();
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(within(row).getByText('320 ms')).toBeInTheDocument();
  });

  it('退出码徽标：0 为绿色（success），非 0 与 -1 为红色（error）', () => {
    render(<ConsolePanel entries={ENTRIES} />);
    expect(screen.getByTestId('console-exit-1')).toHaveClass('ant-tag-success');
    expect(screen.getByTestId('console-exit-2')).toHaveClass('ant-tag-error');
    expect(screen.getByTestId('console-exit-3')).toHaveClass('ant-tag-error');
  });

  it('耗时 >1000ms 显示 s（一位小数）', () => {
    render(<ConsolePanel entries={[ENTRIES[1]]} />);
    expect(screen.getByTestId('console-duration-2')).toHaveTextContent('1.5 s');
  });

  it('stderrTail 在 args 下方小字渲染；空 tail 省略', () => {
    render(<ConsolePanel entries={ENTRIES} />);
    expect(screen.getByTestId('console-stderr-2')).toHaveTextContent('error: pathspec x did not match');
    expect(screen.queryByTestId('console-stderr-1')).not.toBeInTheDocument();
  });

  it('无记录时渲染空态文案', () => {
    render(<ConsolePanel entries={[]} />);
    expect(screen.getByText('暂无命令记录')).toBeInTheDocument();
  });

  it('loading 时显示 Spin', () => {
    render(<ConsolePanel loading />);
    expect(screen.getByTestId('console-loading')).toBeInTheDocument();
  });

  it('点击「刷新」调 onRefresh', () => {
    const onRefresh = vi.fn();
    render(<ConsolePanel entries={ENTRIES} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId('console-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('onRefresh 缺省时不渲染刷新按钮', () => {
    render(<ConsolePanel entries={ENTRIES} />);
    expect(screen.queryByTestId('console-refresh')).not.toBeInTheDocument();
  });
});

describe('foldArgs（GitConsoleFoldingImpl 语义）', () => {
  it('连续 -c key=value 折叠为单个 `-c …`（前后原样）', () => {
    expect(foldArgs(['--no-pager', '-c', 'core.pager=cat', 'log'])).toBe('--no-pager -c … log');
    expect(foldArgs(['-c', 'core.pager=cat', '-c', 'http.host.extraHeader=x', 'fetch'])).toBe('-c … -c … fetch');
  });

  it('无 -c 对时原样 join；结尾孤立的 -c 原样保留（防御）', () => {
    expect(foldArgs(['git', 'add', 'a.ts'])).toBe('git add a.ts');
    expect(foldArgs(['git', '-c'])).toBe('git -c');
  });
});
