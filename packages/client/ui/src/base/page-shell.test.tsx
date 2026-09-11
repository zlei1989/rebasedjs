/**
 * PageShell 测试：断言布局不变量（横向撑满/纵向链/不设 alignItems）与密度施加/豁免。
 * 注：jsdom 无布局引擎，无法断言真实宽度与溢出——宽度类验收由六档浏览器断言承担（设计文档 §8 第 2 项）。
 *
 * antd v6 事实（实测，非假设）：本仓库装的 antd 6.6.1 中 `Flex` **不再写内联布局样式**，
 *   改由类名提供——实测产出
 *   `<div class="ant-flex … ant-flex-vertical ant-flex-align-stretch" style="width:100%;min-width:0px;height:100%">`，
 *   内联 display/flexDirection/alignItems 全为空串，而 jsdom 计算值（cssinjs 已注入 <style>）为
 *   flex / column / stretch。故「antd 提供的那三项」断言计算值，「本组件自己写的样式」断言内联串。
 *
 * 已知偏差（Task 1 的 `density.ts`，本任务无修改权限）：设计 §6/V1 期望紧凑 `fontSize === 12`，
 *   但 antd v6 的 `compactAlgorithm` 以「基础算法派生出的 fontSizeSM」为新基准重新推导整档字号，
 *   显式 `token.fontSize: 12` 反而被覆盖——实测实效为 10（SM 11 / LG 14）。已实测的最小修正在
 *   `density.ts`：`token` 改为 `{ fontSizeSM: 11 }` 即得 12/11/14。故此处不断言字面量 10 或 12，
 *   改为断言 PageShell 的**自身职责**：确实施加了密度、且逐字转交 Task 1 的主题（不在此处自行调值）。
 */
import { render, screen, within } from '@testing-library/react';
import { ConfigProvider, theme } from 'antd';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { DensityMode } from './density';
import { compactTheme } from './density';
import { DensityProvider } from './density-context';
import { PageShell, type PageShellProps } from './page-shell';

/** 主题探针：读取最近 ConfigProvider 合并后的 token（非视觉断言，jsdom 下可靠） */
function TokenProbe(): ReactNode {
  const { token } = theme.useToken();
  return <span data-testid="probe">{`${token.fontSize}`}</span>;
}

/** 底色探针：用于断言 mode → 主题的映射（非视觉断言，jsdom 下可靠） */
function BgProbe(): ReactNode {
  const { token } = theme.useToken();
  return <span data-testid="bg-probe">{`${token.colorBgContainer}`}</span>;
}

/** 在暗色密度 context 下渲染 PageShell，返回根元素 */
function renderShell(props: Partial<PageShellProps> = {}): HTMLElement {
  const { container } = render(
    <DensityProvider mode="dark">
      <PageShell {...props}>
        <TokenProbe />
      </PageShell>
    </DensityProvider>,
  );
  return container.firstElementChild as HTMLElement;
}

/** 基准：把 Task 1 的 compactTheme 直接挂到 ConfigProvider 上，读同一探针的字号 */
function referenceFontSize(mode: DensityMode): string {
  // 同一用例内可能有多次 render，故查询一律限定在本次 container 内（RTL 默认查 document.body）
  const { container } = render(
    <ConfigProvider theme={compactTheme(mode)}>
      <TokenProbe />
    </ConfigProvider>,
  );
  return within(container).getByTestId('probe').textContent ?? '';
}

/** 基准：指定 mode 下经 PageShell 得到的底色 */
function shellBg(mode: DensityMode): string {
  const { container } = render(
    <DensityProvider mode={mode}>
      <PageShell>
        <BgProbe />
      </PageShell>
    </DensityProvider>,
  );
  return within(container).getByTestId('bg-probe').textContent ?? '';
}

/** 基准：把 Task 1 的 compactTheme 直接挂到 ConfigProvider 上，读底色 */
function referenceBg(mode: DensityMode): string {
  const { container } = render(
    <ConfigProvider theme={compactTheme(mode)}>
      <BgProbe />
    </ConfigProvider>,
  );
  return within(container).getByTestId('bg-probe').textContent ?? '';
}

describe('PageShell', () => {
  it('横向撑满且不设 alignItems —— 44 处 align="flex-start" 的解', () => {
    const root = renderShell();
    const computed = getComputedStyle(root);
    expect(computed.display).toBe('flex');
    expect(computed.flexDirection).toBe('column');
    expect(root.style.width).toBe('100%');
    expect(root.style.minWidth).toBe('0px');
    expect(root.style.height).toBe('100%');
    // 不变量：纵向 Flex 的交叉轴是水平方向，align-items 绝不可为 flex-start（实测计算值 stretch，
    // 即子元素默认横向拉伸）。本组件自身不落内联 alignItems，故内联串亦为空。
    expect(computed.alignItems).not.toBe('flex-start');
    expect(root.style.alignItems).toBe('');
  });

  it('默认施加紧凑密度：字号小于 antd 默认 14，且与 Task 1 的 compactTheme 逐字一致', () => {
    renderShell();
    const compactFontSize = screen.getByTestId('probe').textContent;
    expect(Number(compactFontSize)).toBeLessThan(14);
    // 密度数值只许在 density.ts 调整（设计 §6）：PageShell 必须原样转交，不得自行改 token
    expect(compactFontSize).toBe(referenceFontSize('dark'));
  });

  it('density="default" 豁免紧凑密度：字号回到 antd 默认 14', () => {
    renderShell({ density: 'default' });
    expect(screen.getByTestId('probe').textContent).toBe('14');
  });

  it('mode="light" 挂的是 compactTheme("light")，不是暗色主题', () => {
    const lightBg = shellBg('light');
    expect(lightBg).not.toBe(shellBg('dark'));
    expect(lightBg).toBe(referenceBg('light'));
  });

  it('默认不落 padding/gap，不凭空新增间距', () => {
    const root = renderShell();
    expect(root.style.padding).toBe('');
    expect(root.style.gap).toBe('');
  });

  it('显式传入时才落 padding/gap', () => {
    const root = renderShell({ padding: 16, gap: 8 });
    expect(root.style.padding).toBe('16px');
    expect(root.style.gap).toBe('8px');
  });

  it('scroll="inner" 时根自身滚动且带 minHeight:0（纵向主轴需它才生效）', () => {
    const root = renderShell({ scroll: 'inner' });
    expect(root.style.overflow).toBe('auto');
    expect(root.style.minHeight).toBe('0px');
  });

  it('scroll="page" 时不接管滚动', () => {
    const root = renderShell();
    expect(root.style.overflow).toBe('');
  });
});
