/**
 * EllipsisText 测试：断言文本渲染、等宽开关与自带 minWidth:0（flex 内截断的前提）。
 * 注：jsdom 无布局引擎，无法断言真实截断与省略号——那由六档浏览器断言承担。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EllipsisText } from './ellipsis-text';

describe('EllipsisText', () => {
  it('渲染文本内容', () => {
    render(<EllipsisText>6f4a2c1</EllipsisText>);
    expect(screen.getByText('6f4a2c1')).toBeInTheDocument();
  });

  it('自带 minWidth:0 —— flex 容器内截断生效的前提', () => {
    const { container } = render(<EllipsisText>6f4a2c1</EllipsisText>);
    const el = container.querySelector('.ant-typography') as HTMLElement;
    expect(el.style.minWidth).toBe('0px');
  });

  it('mono 用等宽（code）呈现', () => {
    const { container } = render(<EllipsisText mono>6f4a2c1</EllipsisText>);
    expect(container.querySelector('code')).not.toBeNull();
  });

  it('maxWidth 落 style', () => {
    const { container } = render(<EllipsisText maxWidth={220}>very/long/path</EllipsisText>);
    const el = container.querySelector('.ant-typography') as HTMLElement;
    expect(el.style.maxWidth).toBe('220px');
  });

  it('给 title 时开启 antd 原生 ellipsis tooltip 且不抛错', () => {
    render(<EllipsisText title="完整哈希">6f4a2c1</EllipsisText>);
    expect(screen.getByText('6f4a2c1')).toBeInTheDocument();
  });
});
