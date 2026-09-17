import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SplitPane } from './split-pane';

/**
 * SplitPane 已改为 **antd Splitter 的薄适配**（原先自绘 flex + matchMedia 纵向塌缩的实现已删除）。
 * 故这里不再断言「宽屏行 / 窄屏列」的几何细节，只断言适配层的契约：
 *   ① 两个宿主都在、且顺序随 sidePosition 变；
 *   ② 侧栏宽度以像素 defaultSize 交给 Splitter（不再是写死的 style.width）；
 *   ③ 分隔条由 Splitter 提供（`.ant-splitter-bar`），栏数 − 1 条；
 *   ④ 两栏各自保留内部滚动容器。
 * 真实拖拽与夹紧由 antd 自己保证（其内部 useResize 有单测），冒烟在浏览器里核。
 */
describe('SplitPane（antd Splitter 适配）', () => {
  const renderPane = (sidePosition?: 'start' | 'end', sideWidth?: number) =>
    render(
      <SplitPane side={<span data-testid="split-side">侧</span>} {...(sidePosition === undefined ? {} : { sidePosition })} {...(sideWidth === undefined ? {} : { sideWidth })}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );

  it('默认 sidePosition="start"：侧栏宿主在主区之前', () => {
    renderPane();
    expect(screen.getByTestId('split-side-host')).toBeInTheDocument();
    expect(screen.getByTestId('split-main-host')).toBeInTheDocument();
    const hosts = screen.getAllByTestId(/^split-(side|main)-host$/);
    expect(hosts.map((h) => h.dataset.testid)).toEqual(['split-side-host', 'split-main-host']);
  });

  it('sidePosition="end"：侧栏宿主排到主区之后', () => {
    renderPane('end');
    const hosts = screen.getAllByTestId(/^split-(side|main)-host$/);
    expect(hosts.map((h) => h.dataset.testid)).toEqual(['split-main-host', 'split-side-host']);
  });

  it('分隔条由 Splitter 提供：两栏 → 一条', () => {
    renderPane();
    expect(document.querySelectorAll('.ant-splitter-bar')).toHaveLength(1);
  });

  it('sideWidth 传给 Splitter 的 Panel（像素 defaultSize），不再写死 style.width', () => {
    renderPane(undefined, 320);
    // 宿主的宽度由 Panel 分配，故它自身不带写死的 width:320px
    const sideHost = screen.getByTestId('split-side-host');
    expect(sideHost.style.width).toBe('');
    // 内容仍渲染在两栏里
    expect(screen.getByTestId('split-side')).toBeInTheDocument();
    expect(screen.getByTestId('split-main')).toBeInTheDocument();
  });

  it('两栏各自保留内部滚动容器', () => {
    renderPane();
    expect(screen.getByTestId('split-side-host').style.overflow).toBe('auto');
    expect(screen.getByTestId('split-main-host').style.overflow).toBe('auto');
  });
});
