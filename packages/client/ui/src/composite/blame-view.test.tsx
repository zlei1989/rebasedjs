import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine } from '@rebased/contracts';
import { BlameView } from './blame-view';

/** 测试溯源行工厂：补全 BlameLine 必填字段 */
function makeBlameLine(partial: Partial<BlameLine> & { lineno: number }): BlameLine {
  return {
    hash: `hash${partial.lineno}`,
    shortHash: `abc${partial.lineno}`,
    author: `author ${partial.lineno}`,
    authorEmail: `a${partial.lineno}@example.com`,
    dateIso: '2026-01-01T00:00:00Z',
    content: `content ${partial.lineno}`,
    previousLineno: null,
    ...partial,
  };
}

describe('BlameView 渲染', () => {
  it('渲染文件路径头与每行的行号/作者/日期/内容', () => {
    const lines = [
      makeBlameLine({ lineno: 1, content: 'const a = 1;' }),
      makeBlameLine({ lineno: 2, content: 'const b = 2;' }),
    ];
    render(<BlameView file="src/app.ts" lines={lines} />);

    expect(screen.getByTestId('blame-file')).toHaveTextContent('src/app.ts');

    const row1 = screen.getByTestId('blame-line-1');
    expect(row1).toHaveTextContent('1');
    expect(row1).toHaveTextContent('author 1');
    expect(row1).toHaveTextContent('2026-01-01 00:00');
    expect(row1).toHaveTextContent('const a = 1;');

    const row2 = screen.getByTestId('blame-line-2');
    expect(row2).toHaveTextContent('2');
    expect(row2).toHaveTextContent('author 2');
    expect(row2).toHaveTextContent('2026-01-01 00:00');
    expect(row2).toHaveTextContent('const b = 2;');
  });

  it('无行数据时渲染 EmptyState', () => {
    render(<BlameView file="src/app.ts" lines={[]} />);
    expect(screen.getByText('暂无溯源信息')).toBeInTheDocument();
  });
});

describe('BlameView 状态', () => {
  it('loading 时渲染加载态', () => {
    render(<BlameView file="src/app.ts" loading />);
    expect(screen.getByTestId('blame-loading')).toBeInTheDocument();
  });

  it('error 时渲染错误文案', () => {
    render(<BlameView file="src/app.ts" error="加载失败" />);
    expect(screen.getByTestId('blame-error')).toHaveTextContent('加载失败');
  });
});

describe('BlameView 行交互', () => {
  it('点击 hash 徽标以完整哈希调 onOpenCommit', () => {
    const onOpenCommit = vi.fn();
    render(<BlameView file="src/app.ts" lines={[makeBlameLine({ lineno: 3 })]} onOpenCommit={onOpenCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'abc3' }));

    expect(onOpenCommit).toHaveBeenCalledTimes(1);
    expect(onOpenCommit).toHaveBeenCalledWith('hash3');
  });
});
