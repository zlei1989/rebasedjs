import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('渲染标题、描述与操作区', () => {
    render(<EmptyState title="暂无提交" description="请先选择一个仓库" action={<button>刷新</button>} />);
    expect(screen.getByText('暂无提交')).toBeInTheDocument();
    expect(screen.getByText('请先选择一个仓库')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
  });

  it('描述与操作区可省略', () => {
    render(<EmptyState title="空" />);
    expect(screen.getByText('空')).toBeInTheDocument();
  });
});
