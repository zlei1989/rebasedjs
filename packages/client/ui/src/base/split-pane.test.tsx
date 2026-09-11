/**
 * SplitPane 测试：断言宽屏并排、窄屏纵向堆叠、侧栏宽度与主区收缩。
 * 注：用覆盖 window.matchMedia 的方式模拟视口（setup.ts 已装空实现，这里按需替换）。
 *
 * 定位口径：`data-testid="split-side-host"` / `"split-main-host"` 落在 **宿主 div**（承载
 * width/flex/overflow 的那一层，由本组件渲染）；测试里作为 `side` / `children` 传入的
 * `data-testid="split-side"` / `"split-main"` 是**业务子节点**，不是宿主。
 * 本组件自己写进 style 的属性（width / flexShrink / flexGrow / minWidth / overflow）
 * 故一律断内联串，不走 getComputedStyle。
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SplitPane } from './split-pane';

/** 模拟视口是否命中 (max-width: Npx)：stub 后 setup.ts 的 ??= 不会覆盖 */
function stubViewport(narrow: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // 复原为空实现（matches:false = 宽屏），避免污染同文件其它用例
  stubViewport(false);
});

/** 宿主元素（承载 width/flex/overflow 的那一层） */
function hosts(): { side: HTMLElement; main: HTMLElement } {
  return {
    side: screen.getByTestId('split-side-host'),
    main: screen.getByTestId('split-main-host'),
  };
}

describe('SplitPane', () => {
  it('宽屏：侧栏固定宽、主区收缩（flex:1 + minWidth:0）', () => {
    stubViewport(false);
    render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const { side, main } = hosts();
    expect(side.style.width).toBe('300px');
    expect(side.style.flexShrink).toBe('0');
    expect(main.style.flexGrow).toBe('1');
    expect(main.style.minWidth).toBe('0px');
  });

  it('宽屏：sidePosition="end" 时侧栏在主区之后', () => {
    stubViewport(false);
    const { container } = render(
      <SplitPane sidePosition="end" side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.firstElementChild).toBe(screen.getByTestId('split-main-host'));
  });

  it('窄屏：侧栏与主区都占满宽度（纵向堆叠，横向溢出归零）', () => {
    stubViewport(true);
    render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const { side, main } = hosts();
    expect(side.style.width).toBe('100%');
    expect(main.style.width).toBe('100%');
  });

  it('两侧都保留内部滚动', () => {
    stubViewport(false);
    render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const { side, main } = hosts();
    expect(side.style.overflow).toBe('auto');
    expect(main.style.overflow).toBe('auto');
  });

  // sideWidth 由调用点给出（browse 300 / log 320），断言它真的落到宿主宽度上，
  // 而非永远吃默认值 300。
  it('sideWidth 生效（供 log 页 320 宽侧栏使用）', () => {
    stubViewport(false);
    render(
      <SplitPane sideWidth={320} side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    expect(hosts().side.style.width).toBe('320px');
  });

  // collapseBelow 的默认值随后续任务按真机截图校准（768 可能变成 640），
  // 故此用例显式传入 640 并只看 matchMedia 查询串，不依赖默认值本身。
  it('collapseBelow 决定断点查询：(max-width: collapseBelow-1px)', () => {
    const queries: string[] = [];
    window.matchMedia = ((query: string) => {
      queries.push(query);
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    }) as unknown as typeof window.matchMedia;
    render(
      <SplitPane collapseBelow={640} side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    expect(queries).toContain('(max-width: 639px)');
  });
});
