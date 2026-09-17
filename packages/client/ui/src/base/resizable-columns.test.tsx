import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResizableColumns, restoreWidthsToAvailable, type PaneGeometry, type ResizablePane } from './resizable-columns';

/** 面板工厂：宽度/夹紧范围按用例给，其余字段固定 */
function pane(overrides: Partial<ResizablePane> & { key: string; width: number }): ResizablePane {
  return { label: overrides.key, content: <span>{overrides.key}</span>, min: 100, max: 1000, ...overrides };
}

describe('restoreWidthsToAvailable（像素偏好 → 当前可用宽）', () => {
  /** 与日志页同构的几何：第 0 栏是弹性列（日志），其余三栏各有夹紧范围 */
  const panes: PaneGeometry[] = [
    { width: 0, min: 320, max: Number.MAX_SAFE_INTEGER, flexible: true },
    { width: 340, min: 300, max: 560 },
    { width: 460, min: 200, max: 460 },
    { width: 587, min: 548, max: 1200 },
  ];
  const widths = panes.map((p) => p.width);

  it('够宽时原样返回（富余留给 Splitter 的弹性列，不在这里分配）', () => {
    expect(restoreWidthsToAvailable(widths, panes, 1920, 3)).toEqual(widths);
    expect(restoreWidthsToAvailable(widths, panes, 4000, 3)).toEqual(widths);
  });

  it('过窄时按比例收，且每栏不低于自己的 min', () => {
    const fitted = restoreWidthsToAvailable(widths, panes, 900, 3);
    // 百分比收缩后各栏比原值小、但不小于 min
    expect(fitted[1]).toBeLessThan(340);
    expect(fitted[1]).toBeGreaterThanOrEqual(300);
    expect(fitted[2]).toBeGreaterThanOrEqual(200);
    expect(fitted[3]).toBeGreaterThanOrEqual(548);
  });

  it('过窄时按比例收 + 逐栏夹紧（低于 min 的抬回 min，高于 min 的保持比例）', () => {
    // 可用 900、3 条分隔条占 18 → 预算 882；原总宽 1387 → 比例 0.636
    //   log  0×0.636 = 0     → 抬到 min 320
    //   details 340×0.636 = 216 → 抬到 min 300
    //   tree    460×0.636 = 293 → 高于 min 200，保持
    //   content 587×0.636 = 373 → 抬到 min 548
    const fitted = restoreWidthsToAvailable(widths, panes, 900, 3).map((w) => Math.round(w));
    expect(fitted[1]).toBe(300);
    expect(fitted[2]).toBe(293);
    expect(fitted[3]).toBe(548);
  });

  it('可用宽为 0（未测量/jsdom）时不改宽度', () => {
    expect(restoreWidthsToAvailable(widths, panes, 0, 3)).toEqual(widths);
  });
});

describe('ResizableColumns（antd Splitter 配置映射）', () => {
  const build = () =>
    render(
      <ResizableColumns
        onWidthsChange={vi.fn()}
        panes={[
          { ...pane({ key: 'log', width: 400, min: 320, max: 900 }), flexible: true },
          { ...pane({ key: 'details', width: 340, min: 300, max: 560 }) },
          { ...pane({ key: 'tree', width: 260, min: 200, max: 460 }) },
        ]}
      />,
    );

  it('每栏渲染一个宿主（调用方据此定位内容与量高度）', () => {
    build();
    expect(screen.getAllByTestId(/^resizable-pane-/).map((el) => el.dataset.testid)).toEqual([
      'resizable-pane-log',
      'resizable-pane-details',
      'resizable-pane-tree',
    ]);
  });

  it('分隔条由 antd Splitter 提供（栏数 − 1 条），不再自绘', () => {
    build();
    expect(document.querySelectorAll('.ant-splitter-bar')).toHaveLength(2);
  });

  it('栏宿主自带「撑满 + 纵向 flex + 裁剪」：这是高度与滚动的约束层', () => {
    build();
    const host = screen.getByTestId('resizable-pane-log');
    expect(host.style.height).toBe('100%');
    expect(host.style.display).toBe('flex');
    expect(host.style.flexDirection).toBe('column');
    expect(host.style.overflow).toBe('hidden');
  });

  it('栏宿主是**唯一**一层节点：宿主里直接放内容（不再套内容层 div）', () => {
    build();
    const host = screen.getByTestId('resizable-pane-tree');
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild?.textContent).toBe('tree');
  });

  it('调用方的 style 可覆盖默认（如滚动型栏改成 block + auto）', () => {
    render(
      <ResizableColumns
        onWidthsChange={vi.fn()}
        panes={[
          { ...pane({ key: 'log', width: 400 }), flexible: true },
          { ...pane({ key: 'tree', width: 260 }), style: { padding: 8, overflow: 'auto', display: 'block' } },
        ]}
      />,
    );
    const host = screen.getByTestId('resizable-pane-tree');
    expect(host.style.display).toBe('block');
    expect(host.style.overflow).toBe('auto');
    expect(host.style.padding).toBe('8px');
  });

  it('空栏数组不渲染（Splitter 要求至少一个 Panel）', () => {
    const { container } = render(<ResizableColumns onWidthsChange={vi.fn()} panes={[]} />);
    expect(container.querySelector('.ant-splitter')).toBeNull();
  });
});
