import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VirtualList } from './virtual-list';

describe('VirtualList', () => {
  it('仅渲染可见窗口内的行', () => {
    render(
      <VirtualList
        items={Array.from({ length: 100 }, (_, i) => `row${i}`)}
        rowHeight={20}
        height={100}
        renderRow={(item) => <div>{item}</div>}
      />,
    );
    // 100px / 20px = 5 行可见（含 overscan 容差）
    expect(screen.getAllByText(/^row\d+$/).length).toBeLessThanOrEqual(10);
    expect(screen.getByText('row0')).toBeInTheDocument();
  });
});
