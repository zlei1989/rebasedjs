/**
 * Toolbar 测试：断言换行不变量、对齐映射与默认不落间距。
 *
 * antd v6 事实（与 PageShell 同一实测结论）：本仓库装的 antd 6.6.1 中 `Flex` **不写内联布局样式**，
 *   改由类名提供（实测产出 `<div class="ant-flex ant-flex-align-center ant-flex-wrap-wrap" style="width:100%;min-width:0px">`，
 *   内联 flexWrap/justifyContent/alignItems 全为空串，而 jsdom 计算值（cssinjs 已注入 <style>）为实际布局值）。
 *   故：antd 由 props 控制的三项（flexWrap / justifyContent / alignItems）断言 getComputedStyle 计算值；
 *   本组件自己写进 style 的 width / minWidth / gap 仍断言内联串。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './toolbar';

/** 渲染 Toolbar 并返回根元素 */
function renderToolbar(props: Parameters<typeof Toolbar>[0]): HTMLElement {
  const { container } = render(<Toolbar {...props}>{null}</Toolbar>);
  return container.firstElementChild as HTMLElement;
}

describe('Toolbar', () => {
  it('默认允许换行（D-12 那类挤压 bug 的修法）', () => {
    const root = renderToolbar({ children: null });
    expect(getComputedStyle(root).flexWrap).toBe('wrap');
  });

  it('容器横向撑满且可收缩', () => {
    const root = renderToolbar({ children: null });
    expect(root.style.width).toBe('100%');
    expect(root.style.minWidth).toBe('0px');
  });

  it('wrap={false} 时不换行', () => {
    const root = renderToolbar({ children: null, wrap: false });
    expect(getComputedStyle(root).flexWrap).toBe('nowrap');
  });

  it('至少能断言 align="center" 的映射（内容居中）', () => {
    const root = renderToolbar({ children: null, align: 'center' });
    expect(getComputedStyle(root).justifyContent).toBe('center');
  });

  it('默认不落 gap', () => {
    const root = renderToolbar({ children: null });
    expect(root.style.gap).toBe('');
  });

  it('显式传入才落 gap', () => {
    const root = renderToolbar({ children: null, gap: 8 });
    expect(root.style.gap).toBe('8px');
  });
});
