import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonacoDiffView } from './monaco-diff-view';

describe('MonacoDiffView', () => {
  it('懒加载未完成前显示占位，不因 monaco 缺失崩溃', () => {
    // loader 注入永不 resolve 的 Promise，模拟 monaco 尚未加载
    render(<MonacoDiffView original="a" modified="b" loader={() => new Promise(() => {})} />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it('loader 注入的模块加载完成后渲染其默认导出组件', async () => {
    const Stub = (): React.ReactNode => <div>stub-diff-editor</div>;
    render(
      <MonacoDiffView original="a" modified="b" loader={() => Promise.resolve({ default: Stub })} />,
    );
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });
});
