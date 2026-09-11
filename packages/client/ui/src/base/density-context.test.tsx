/**
 * 密度 context 测试：断言 pack 提供的 mode 被读取、缺省回退为暗色。
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DensityProvider, useDensityMode } from './density-context';

/** 探针：把 context 里的 mode 渲染成可断言的文本 */
function ModeProbe(): ReactNode {
  return <span data-testid="mode">{useDensityMode()}</span>;
}

describe('useDensityMode', () => {
  it('读取 DensityProvider 提供的 mode', () => {
    render(
      <DensityProvider mode="light">
        <ModeProbe />
      </DensityProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });

  it('无 Provider 时回退为 dark（与 web-koa 现状一致）', () => {
    render(<ModeProbe />);
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });
});
