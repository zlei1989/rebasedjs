/**
 * SplitPane 测试：断言宽屏并排、窄屏纵向堆叠、侧栏宽度与主区收缩。
 * 注：用覆盖 window.matchMedia 的方式模拟视口（setup.ts 已装空实现，这里按需替换）。
 *
 * 定位口径：`data-testid="split-side-host"` / `"split-main-host"` 落在 **宿主 div**（承载
 * width/flex/overflow 的那一层，由本组件渲染）；测试里作为 `side` / `children` 传入的
 * `data-testid="split-side"` / `"split-main"` 是**业务子节点**，不是宿主。
 * 本组件自己写进 style 的属性（width / flex / flexShrink / flexGrow / minWidth / minHeight / overflow / gap）
 * 故一律断内联串；惟 `flexDirection` 由 antd `Flex vertical` 的类名控制，按 Tasks 3–5 的既定规则
 * 断 getComputedStyle 计算值。
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

  // 窄屏分支的头号行为：容器必须是**列**。若 `vertical` 从 <Flex vertical …> 上被删掉，
  // 容器退回 row，两个 width:100% 的孩子就会并排 —— 正是本任务要消灭的横向溢出，
  // 而下面「都占满宽度」的断言对此毫无察觉（它只看 width）。故此处断言 flexDirection。
  it('窄屏：塌缩后的根容器是纵向（column）容器', () => {
    stubViewport(true);
    const { container } = render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(getComputedStyle(root).flexDirection).toBe('column');
  });

  // 窄屏两侧都必须能内部滚动、且都留出高度预算（minHeight:0），
  // 否则高度由内容决定、overflow:auto 永不生效（宽屏那条 overflow 用例覆盖不到这一分支）。
  it('窄屏：两侧都保留内部滚动并留出高度预算', () => {
    stubViewport(true);
    render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const { side, main } = hosts();
    expect(side.style.overflow).toBe('auto');
    expect(main.style.overflow).toBe('auto');
    expect(side.style.minHeight).toBe('0px');
    expect(main.style.minHeight).toBe('0px');
  });

  // 窄屏两侧都不得被压成 0 高：等分高度靠 flex-basis:0（flex 简写 '1 1 0'）。
  // 若某一侧退回旧几何（侧栏 flexShrink:0 无高度预算 / 主区 basis:0% 又不可伸），
  // 该侧要么吃满内容高度要么解析为 0，此断言即失败。
  it('窄屏：两侧等分高度且都可伸缩（flex:1 1 0）', () => {
    stubViewport(true);
    render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const { side, main } = hosts();
    for (const host of [side, main]) {
      expect(host.style.flexGrow).toBe('1');
      expect(host.style.flexShrink).toBe('1');
      expect(host.style.flexBasis).toBe('0%');
    }
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

  // 两栏之间的缝原本由调用点的 <Flex gap={12}> 提供，迁到本原语后必须仍能表达（见 split-pane.tsx 的 gap JSDoc）。
  it('gap 生效：落在宽屏行容器的 flex gap 上', () => {
    stubViewport(false);
    const { container } = render(
      <SplitPane gap={12} side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.gap).toBe('12px');
  });

  // 塌缩分支的缝必须落在**列**容器上（纵轴）：若 gap 只写进宽屏那条 return，
  // 窄屏就静默丢缝，而上面那条用例只看宽屏、对此毫无察觉（本组用例的存在理由）。
  it('窄屏：gap 同样落在塌缩后的列容器上（纵轴间距）', () => {
    stubViewport(true);
    const { container } = render(
      <SplitPane gap={12} side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(getComputedStyle(root).flexDirection).toBe('column');
    expect(root.style.gap).toBe('12px');
  });

  // **判别性用例**：gap={0} 是显式传值，必须照样落 style。
  // 若守卫写成真值判断 `if (gap)`（而不是 `!== undefined`），0 会被误判成「没传」而丢掉，
  // 本用例失败、而上面 gap={12} 那条仍通过 —— 即本用例能把「对的守卫」与「出错的守卫」分开。
  // 实测（临时把守卫改成 `if (gap)` 后重跑）：仅本用例失败，见 task-11-report.md「Fix round 1」§1.3。
  it('gap={0} 是显式取值，不被当作未传而丢弃', () => {
    stubViewport(false);
    const { container } = render(
      <SplitPane gap={0} side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    expect((container.firstElementChild as HTMLElement).style.gap).toBe('0px');
  });

  // 反向用例：不传 gap 时**不落 gap**（既有调用点如 log 页保持在先的零间距行为）。
  // 同时断言结构性不变量仍在，避免「不落 gap」被写成「整个 style 不落」而误判通过。
  it('不传 gap：容器 style 里没有 gap，但结构几何不变', () => {
    stubViewport(false);
    const { container } = render(
      <SplitPane side={<span data-testid="split-side">侧</span>}>
        <span data-testid="split-main">主</span>
      </SplitPane>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.gap).toBe('');
    expect(row.style.flexGrow).toBe('1');
    expect(row.style.minWidth).toBe('0px');
    expect(row.style.minHeight).toBe('0px');
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
