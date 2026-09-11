/**
 * EllipsisText 测试：断言文本渲染、等宽开关、自带 minWidth:0（flex 内截断的前提）、
 * maxWidth 守卫（含 maxWidth={0}）、**ellipsis 启用标记**与 **type 透传（承色类，成对正/反断言）**。
 *
 * 这里能断什么、不能断什么（antd 6.6.1 实测结论）：
 *
 * **能断 —— 「ellipsis 已启用」这一启用标记**由类名与计算样式承载：
 *   根元素带 `ant-typography-ellipsis` 与 `ant-typography-ellipsis-single-line`（截断 CSS 的唯一载体，
 *   去掉 `ellipsis` prop 即整类消失）；cssinjs 已把 <style> 注入 document，故 getComputedStyle 得
 *   whiteSpace: nowrap / textOverflow: ellipsis / overflow: hidden。
 *   与 Toolbar / PageShell 同一口径：antd 由 props 控制的属性断类名或计算值；
 *   本组件自己写进 style 的 minWidth / maxWidth 仍断内联串。
 *
 * **不能断 —— 真实截断渲染**（省略号字符、"不撑宽容器"）：jsdom 无布局引擎，scrollWidth/clientWidth 恒为 0，
 *   几何相关的断言只能由六档浏览器断言承担。
 *
 * **不能断 —— antd 原生 ellipsis tooltip 的可见性**：antd 把 tooltip 节点挂在一次**布局溢出测量**
 *   （scrollWidth / clientWidth 对比）之上，jsdom 永远测不出溢出，节点因而恒不渲染；
 *   其 EllipsisTooltip 在 !isEllipsis 时不启用、内容亦惰性渲染。因此 `title` 透传之后在 jsdom 中
 *   **不留任何可观察痕迹**（实测根 <span> 上无 title 属性、无新增节点）。
 *   故带 title 的用例据实降级为 no-crash 冒烟，并附带断言「ellipsis 仍处于启用态」——那是该路径在 jsdom 里
 *   唯一真实可断的部分。详见文件末「未能覆盖（交由浏览器门禁）」。
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

  // type 透传（Ruling P17）：次要色长文本转进本原语后必须仍然保持次要色。
  // 判别性来自**成对断言**：只断「传了 type 有类名」无法区分「真的转发」与「实现里写死了 type="secondary"」；
  // 反向再断「不传 type 时该类名缺席」，才把两条实现路径分开。
  // 类名是实测口径（antd 6.6.1 用 CSS 类承色，非内联样式）：
  //   传 type="secondary" → 根 <span> 类名含 `ant-typography-secondary`（并含 ant-typography-ellipsis*）；
  //   不传 type        → 类名只有 `ant-typography ant-typography-ellipsis ant-typography-ellipsis-single-line` 等，无 `-secondary`。
  it('type 转发到 antd：传 secondary 有承色类，未传则无该类', () => {
    const { container, unmount } = render(<EllipsisText type="secondary">origin/feature-x</EllipsisText>);
    const el = container.querySelector('.ant-typography') as HTMLElement;
    expect(el).toHaveClass('ant-typography-secondary');
    // 顺带守住「转发 type 不该弄丢截断」：两件事必须同时成立
    expect(el).toHaveClass('ant-typography-ellipsis');

    unmount();
    const { container: plain } = render(<EllipsisText>origin/feature-x</EllipsisText>);
    expect(plain.querySelector('.ant-typography')).not.toHaveClass('ant-typography-secondary');
  });

  it('maxWidth 落 style', () => {
    const { container } = render(<EllipsisText maxWidth={220}>very/long/path</EllipsisText>);
    const el = container.querySelector('.ant-typography') as HTMLElement;
    expect(el.style.maxWidth).toBe('220px');
  });

  it('maxWidth={0} 仍落 style（!== undefined 守卫，而非真值判断）', () => {
    const { container } = render(<EllipsisText maxWidth={0}>x</EllipsisText>);
    const el = container.querySelector('.ant-typography') as HTMLElement;
    expect(el.style.maxWidth).toBe('0px');
  });

  // 本原语的核心目的就是截断：把 `ellipsis` prop 整个删掉，类名与计算样式同时消失，
  // 截断 CSS 随之失效——这条断言是让那种回归无法静默通过的唯一手段。
  it('ellipsis 已启用：截断类名与计算样式同时在场', () => {
    const { container } = render(<EllipsisText>6f4a2c1</EllipsisText>);
    const el = container.querySelector('.ant-typography') as HTMLElement;
    expect(el).toHaveClass('ant-typography-ellipsis');
    expect(el).toHaveClass('ant-typography-ellipsis-single-line');
    const computed = getComputedStyle(el);
    expect(computed.whiteSpace).toBe('nowrap');
    expect(computed.textOverflow).toBe('ellipsis');
    expect(computed.overflow).toBe('hidden');
  });

  it('有 title 与无 title 均正常渲染（tooltip 可见性为布局相关，见下方「未能覆盖」）', () => {
    const { container, unmount } = render(<EllipsisText title="完整哈希">6f4a2c1</EllipsisText>);
    expect(screen.getByText('6f4a2c1')).toBeInTheDocument();
    // title 走的是 `ellipsis={{ tooltip: title }}`，在 jsdom 里唯一可断的痕迹是「ellipsis 仍启用」；
    // tooltip 节点本身不渲染，故此处不断言可见性（原因见文件头与文件末）。
    expect(container.querySelector('.ant-typography')).toHaveClass('ant-typography-ellipsis');

    unmount();
    render(<EllipsisText>6f4a2c1</EllipsisText>);
    expect(screen.getByText('6f4a2c1')).toBeInTheDocument();
  });
});

/**
 * 未能覆盖（交由浏览器门禁）：
 * 1. **tooltip 可见性路径** —— antd 以布局溢出测量（scrollWidth/clientWidth）决定是否渲染 tooltip 节点，
 *    jsdom 测不出溢出，`title` 透传后无任何可观察痕迹；故本文件只覆盖「不抛错」与「ellipsis 仍启用」。
 *    「hover 出现完整值、短文本不出现」必须由浏览器门禁判定。
 * 2. **真实截断渲染** —— 省略号字符是否出现、长 hash/路径是否真的不撑宽容器、`mono` 时省略号落在内层 <code>：
 *    全部依赖真实布局，jsdom 无法产生，交由浏览器门禁。
 */
