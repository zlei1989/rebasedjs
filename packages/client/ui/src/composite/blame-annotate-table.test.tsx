import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine } from '@rebased/contracts';
import { BlameAnnotateTable } from './blame-annotate-table';

/** 工作区未提交行的伪哈希（git blame 的边界提交） */
const ZERO_HASH = '0'.repeat(40);

/** 测试溯源行工厂：补全 BlameLine 必填字段 */
function makeLine(partial: Partial<BlameLine> & { lineno: number }): BlameLine {
  return {
    hash: `hash${partial.lineno}`,
    shortHash: `abc${partial.lineno}`,
    author: `author ${partial.lineno}`,
    authorEmail: `a${partial.lineno}@example.com`,
    dateIso: '2026-01-01T00:00:00+00:00',
    content: `content ${partial.lineno}`,
    previousLineno: null,
    parents: [],
    ...partial,
  };
}

describe('BlameAnnotateTable 渲染', () => {
  it('每行渲染行号/短哈希/作者/日期/内容', () => {
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, content: 'const a = 1;' }), makeLine({ lineno: 2, content: 'const b = 2;' })]}
      />,
    );
    const row1 = screen.getByTestId('blame-line-1');
    expect(row1).toHaveTextContent('1');
    expect(row1).toHaveTextContent('abc1');
    expect(row1).toHaveTextContent('author 1');
    expect(row1).toHaveTextContent('2026-01-01 00:00');
    expect(row1).toHaveTextContent('const a = 1;');
    expect(screen.getByTestId('blame-line-2')).toHaveTextContent('const b = 2;');
  });

  it('loading / error / 空行三态', () => {
    const { rerender } = render(<BlameAnnotateTable loading />);
    expect(screen.getByTestId('blame-loading')).toBeInTheDocument();
    rerender(<BlameAnnotateTable error="加载失败" />);
    expect(screen.getByTestId('blame-error')).toHaveTextContent('加载失败');
    rerender(<BlameAnnotateTable lines={[]} />);
    expect(screen.getByText('暂无溯源信息')).toBeInTheDocument();
  });
});

describe('BlameAnnotateTable 行交互', () => {
  it('点行以该行归属的提交调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 3, hash: 'fullhash3' })]} onSelectCommit={onSelectCommit} />);
    fireEvent.click(screen.getByTestId('blame-line-3'));
    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash3');
  });

  it('选中提交的行带 data-selected，其余行不带', () => {
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1, hash: 'h1' }), makeLine({ lineno: 2, hash: 'h2' })]} selectedHash="h2" />);
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('data-selected');
    expect(screen.getByTestId('blame-line-2')).toHaveAttribute('data-selected', 'true');
  });

  it('工作区未提交行（全 0 伪哈希）：标注「未提交」且不可点', () => {
    const onSelectCommit = vi.fn();
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: ZERO_HASH, shortHash: '0000000' })]}
        onSelectCommit={onSelectCommit}
      />,
    );
    expect(screen.getByTestId('blame-line-1')).toHaveTextContent('未提交');
    fireEvent.click(screen.getByTestId('blame-line-1'));
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  it('未注入 onSelectCommit：行只读（点击不抛错）', () => {
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1 })]} />);
    fireEvent.click(screen.getByTestId('blame-line-1'));
    expect(screen.getByTestId('blame-line-1')).toBeInTheDocument();
  });

  it.each([
    { name: 'Enter', key: 'Enter', prevented: false },
    { name: 'Space', key: ' ', prevented: true },
  ])('键盘 $name 激活可点行：以完整哈希调 onSelectCommit', ({ key, prevented }) => {
    const onSelectCommit = vi.fn();
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 4, hash: 'fullhash4' })]} onSelectCommit={onSelectCommit} />);
    const row = screen.getByTestId('blame-line-4');
    // 经 createEvent 取原生事件对象：Space 必须 preventDefault（默认行为是滚动页面），Enter 不该拦
    const event = createEvent.keyDown(row, { key });
    fireEvent(row, event);
    expect(event.defaultPrevented).toBe(prevented);
    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash4');
  });

  it('可点行可聚焦，不可点行（未提交 / 未注入回调）不可聚焦', () => {
    const { unmount } = render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: ZERO_HASH }), makeLine({ lineno: 2, hash: 'h2' })]}
        onSelectCommit={() => {}}
      />,
    );
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('role');
    expect(screen.getByTestId('blame-line-2')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('blame-line-2')).toHaveAttribute('role', 'button');
    unmount();

    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1 })]} />);
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('role');
  });
});
