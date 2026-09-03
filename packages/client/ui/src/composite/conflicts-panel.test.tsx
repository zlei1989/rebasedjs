import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConflictList } from '@rebased/contracts';
import { ConflictsPanel, conflictKindLabel } from './conflicts-panel';

describe('conflictKindLabel', () => {
  it('[1,2,3] → 双方修改', () => {
    expect(conflictKindLabel([1, 2, 3])).toBe('双方修改');
  });

  it('[2,3] → 双方新增', () => {
    expect(conflictKindLabel([2, 3])).toBe('双方新增');
  });

  it('[1,2] → 对方删除/我方修改', () => {
    expect(conflictKindLabel([1, 2])).toBe('对方删除/我方修改');
  });

  it('[1,3] → 我方删除/对方修改', () => {
    expect(conflictKindLabel([1, 3])).toBe('我方删除/对方修改');
  });

  it('乱序 stages 按同一组合识别（[3,2,1] 同 [1,2,3]）', () => {
    expect(conflictKindLabel([3, 2, 1])).toBe('双方修改');
    expect(conflictKindLabel([3, 2])).toBe('双方新增');
  });

  it('其他组合 → 冲突（[1]、[2]、[1,2,3,4]、空数组）', () => {
    expect(conflictKindLabel([1])).toBe('冲突');
    expect(conflictKindLabel([2])).toBe('冲突');
    expect(conflictKindLabel([1, 2, 3, 4])).toBe('冲突');
    expect(conflictKindLabel([])).toBe('冲突');
  });
});

const CONFLICTS: ConflictList = {
  conflicts: [
    { path: 'src/a.ts', stages: [1, 2, 3] },
    { path: 'src/b.ts', stages: [2, 3] },
    { path: 'src/c.ts', stages: [1, 2] },
    { path: 'src/d.ts', stages: [1, 3] },
    { path: 'src/e.ts', stages: [2] },
  ],
};

/** 测试回调工厂 */
function makeHandlers() {
  return { onResolve: vi.fn(), onOpenMergeView: vi.fn(), onContinue: vi.fn() };
}

describe('ConflictsPanel 列表渲染', () => {
  it('渲染全部冲突行：路径 + 对应冲突类型徽标', () => {
    render(<ConflictsPanel conflicts={CONFLICTS} {...makeHandlers()} />);
    expect(screen.getByTestId('conflict-row-src/a.ts')).toHaveTextContent('双方修改');
    expect(screen.getByTestId('conflict-row-src/b.ts')).toHaveTextContent('双方新增');
    expect(screen.getByTestId('conflict-row-src/c.ts')).toHaveTextContent('对方删除/我方修改');
    expect(screen.getByTestId('conflict-row-src/d.ts')).toHaveTextContent('我方删除/对方修改');
    expect(screen.getByTestId('conflict-row-src/e.ts')).toHaveTextContent('冲突');
  });

  it('空冲突列表时无行，展示无冲突占位', () => {
    render(<ConflictsPanel conflicts={{ conflicts: [] }} {...makeHandlers()} />);
    expect(screen.queryByTestId(/^conflict-row-/)).not.toBeInTheDocument();
    expect(screen.getByText('无冲突')).toBeInTheDocument();
  });
});

describe('ConflictsPanel 行操作', () => {
  it('「用我们的」：传出 {strategy:"ours", path}', () => {
    const { onResolve } = makeHandlers();
    render(
      <ConflictsPanel conflicts={CONFLICTS} onResolve={onResolve} onOpenMergeView={() => {}} onContinue={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('resolve-ours-src/a.ts'));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({ strategy: 'ours', path: 'src/a.ts' });
  });

  it('「用他们的」：传出 {strategy:"theirs", path}', () => {
    const { onResolve } = makeHandlers();
    render(
      <ConflictsPanel conflicts={CONFLICTS} onResolve={onResolve} onOpenMergeView={() => {}} onContinue={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('resolve-theirs-src/b.ts'));
    expect(onResolve).toHaveBeenCalledWith({ strategy: 'theirs', path: 'src/b.ts' });
  });

  it('「手动合并」：调 onOpenMergeView(path)，不触发 onResolve', () => {
    const { onResolve, onOpenMergeView } = makeHandlers();
    render(
      <ConflictsPanel
        conflicts={CONFLICTS}
        onResolve={onResolve}
        onOpenMergeView={onOpenMergeView}
        onContinue={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('merge-manual-src/c.ts'));
    expect(onOpenMergeView).toHaveBeenCalledTimes(1);
    expect(onOpenMergeView).toHaveBeenCalledWith('src/c.ts');
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('resolving 时行操作按钮禁用', () => {
    render(<ConflictsPanel conflicts={CONFLICTS} resolving {...makeHandlers()} />);
    expect(screen.getByTestId('resolve-ours-src/a.ts')).toBeDisabled();
    expect(screen.getByTestId('resolve-theirs-src/a.ts')).toBeDisabled();
    expect(screen.getByTestId('merge-manual-src/a.ts')).toBeDisabled();
  });
});

describe('ConflictsPanel 完成合并', () => {
  it('存在未解决冲突时「完成合并」禁用，悬停提示"还有未解决的冲突"', async () => {
    const { onContinue } = makeHandlers();
    render(
      <ConflictsPanel conflicts={CONFLICTS} onResolve={() => {}} onOpenMergeView={() => {}} onContinue={onContinue} />,
    );
    const button = screen.getByRole('button', { name: /完成合并/ });
    expect(button).toBeDisabled();
    // 禁用按钮不派发 hover，悬停在其外层 span 上触发 Tooltip
    fireEvent.mouseEnter(screen.getByTestId('continue-merge-wrap'));
    expect(await screen.findByText('还有未解决的冲突')).toBeInTheDocument();
  });

  it('全部解决（空列表）时「完成合并」可用，点击触发 onContinue', () => {
    const { onContinue } = makeHandlers();
    render(
      <ConflictsPanel
        conflicts={{ conflicts: [] }}
        onResolve={() => {}}
        onOpenMergeView={() => {}}
        onContinue={onContinue}
      />,
    );
    const button = screen.getByRole('button', { name: /完成合并/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('continuing 时「完成合并」进入 loading 态', () => {
    render(<ConflictsPanel conflicts={{ conflicts: [] }} continuing {...makeHandlers()} />);
    expect(screen.getByRole('button', { name: /完成合并/ })).toHaveClass('ant-btn-loading');
  });
});
