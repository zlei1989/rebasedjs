import { fireEvent, render, screen, within } from '@testing-library/react';
import { theme } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@rebased/contracts';
import { CommitGraph } from './commit-graph';
import { colorForRef } from '../graph-layout/color';
import { compactTheme } from '../base/density';

/** 测试提交工厂：补全 CommitInfo 必填字段，按需覆盖 */
function makeCommit(overrides: Partial<CommitInfo> & { hash: string }): CommitInfo {
  return {
    shortHash: overrides.hash.slice(0, 7),
    parents: [],
    author: 'Alice',
    authorEmail: 'alice@example.com',
    dateIso: '2026-09-01T14:30:00+08:00',
    refs: [],
    message: '提交说明',
    graph: '',
    ...overrides,
  };
}

/** 3 提交（含 merge）：c3 合并 c2 与 c1 */
const commits: CommitInfo[] = [
  makeCommit({ hash: 'c3merge0000001', parents: ['c2', 'c1'], message: '合并 feature 分支' }),
  makeCommit({ hash: 'c2', parents: ['c1'], message: '第二笔提交' }),
  makeCommit({ hash: 'c1', parents: [], message: '初始提交' }),
];

describe('CommitGraph', () => {
  it('按提交数渲染行（3 提交含 merge → 3 行）', () => {
    render(<CommitGraph commits={commits} />);
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(3);
    expect(screen.getByText('合并 feature 分支')).toBeInTheDocument();
    expect(screen.getByText('第二笔提交')).toBeInTheDocument();
    expect(screen.getByText('初始提交')).toBeInTheDocument();
  });

  it('点击行触发 onSelect(hash)', () => {
    const onSelect = vi.fn();
    render(<CommitGraph commits={commits} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('第二笔提交'));
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('行默认列含 Author 与格式化日期', () => {
    render(<CommitGraph commits={commits} />);
    expect(screen.getAllByText('Alice')).toHaveLength(3);
    expect(screen.getAllByText('2026-09-01 14:30')).toHaveLength(3);
  });

  it('分支 chips 默认开、tag chips 默认关；showTags 后显示标签', () => {
    const withRefs: CommitInfo[] = [
      makeCommit({ hash: 'r1', refs: ['main', 'tag: v1.0'], message: '带引用' }),
    ];
    const { rerender } = render(<CommitGraph commits={withRefs} />);
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.queryByText('v1.0')).not.toBeInTheDocument();
    rerender(<CommitGraph commits={withRefs} showTags />);
    expect(screen.getByText('v1.0')).toBeInTheDocument();
  });

  // 冒烟 F-010：分支 chip 底色 = colorForRef(分支名)（与图车道同源、按名稳定），tag chip 不参与
  it('分支 chip 底色取 ref 名 hash 色板，同名稳定异名相异', () => {
    const withRefs: CommitInfo[] = [
      makeCommit({ hash: 'r1', refs: ['main', 'feature'], message: '双分支' }),
    ];
    render(<CommitGraph commits={withRefs} />);
    expect(screen.getByTestId('ref-chip-main')).toHaveStyle({ backgroundColor: colorForRef('main') });
    expect(screen.getByTestId('ref-chip-feature')).toHaveStyle({ backgroundColor: colorForRef('feature') });
    expect(colorForRef('main')).not.toBe(colorForRef('feature'));
  });

  // 行内间距口径（用户口径 8px）：说明区「说明文字 ↔ refs chips」的间距交给 antd Flex 的档位类名，
  // 组件与调用点都不再写内联 gap —— 内联间距绕过主题密度，且一个档位调不了两处。
  it('说明区不写内联间距：8px 由 antd Flex 的档位类名提供', () => {
    render(<CommitGraph commits={commits} />);
    const box = within(screen.getAllByTestId('commit-graph-row')[0]).getByTestId('commit-graph-message');
    // 不变量：该子树里任何元素都不得用内联 gap/columnGap/rowGap 表达间距
    const inlineGap = [...box.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.style.gap !== '' || el.style.columnGap !== '' || el.style.rowGap !== '',
    );
    expect(inlineGap.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    // 机制：间距与交叉轴居中都由类名提供（gap=middle → .ant-flex-gap-middle）
    expect(box.className).toContain('ant-flex-gap-middle');
    expect(box.className).toContain('ant-flex-align-center');
    // 口径锚点：middle 档 = 主题 `padding` token，而全站默认密度为紧凑
    // （PageShell → base/density.ts 的 compactAlgorithm）——两者相等，8px 才成立。
    // 谁动了 density.ts 的间距 token、或把该行挂到非紧凑子树下，这里立刻变红。
    expect(theme.getDesignToken(compactTheme('light')).padding).toBe(8);
    expect(theme.getDesignToken(compactTheme('dark')).padding).toBe(8);
  });

  // 多个 ref chip 之间的间距（用户口径 4px，视觉上更紧凑）：chips 之间的空隙由 antd `Flex` 的档位类名统一给。
  // 关键不变量有两条：
  //   ① 每个 chip 必须是容器的**直接子项**（档位 gap 只作用于直接子项；用一个 Fragment 包成一坨就一个像素都没有）；
  //   ② chip 自己可收缩 + 省略号 + `title` 全名 —— 旧实现走 antd `Space`，每个 chip 被包进不可收缩的
  //      `div.ant-space-item`，列宽一到上限就只能被容器硬切（实测 3 个 chip 时第 3 个完全不可见）。
  it('chip 间距走 antd Flex 档位，且每个 chip 可省略号收缩（不再被容器硬切）', () => {
    const withRefs: CommitInfo[] = [
      makeCommit({ hash: 'r1', refs: ['main', 'feature', 'tag: v1.0'], message: '多引用' }),
    ];
    render(<CommitGraph commits={withRefs} showTags />);
    const wrap = screen.getByTestId('commit-graph-refs');
    const bar = wrap.firstElementChild as HTMLElement;
    expect(bar.className).toContain('ant-flex');
    expect(bar.className).toContain('ant-flex-gap-small');
    // 间距既不写内联、也不靠 chip 自己的 margin（antd v6 的 Tag 无默认 margin，实测 0）
    expect(bar.style.columnGap).toBe('');
    expect(bar.style.rowGap).toBe('');
    // 口径锚点：small 档 = 主题 `paddingXS` token，紧凑密度下恰为 4px
    // （与说明区 Flex 的 `middle` = `padding` = 8px 是两个档位，互不影响）
    expect(theme.getDesignToken(compactTheme('light')).paddingXS).toBe(4);
    expect(theme.getDesignToken(compactTheme('dark')).paddingXS).toBe(4);
    // 3 个 chip（main / feature / v1.0）直接是柔性容器的子项，没有 Space 的包装层
    const chips = [...bar.children] as HTMLElement[];
    expect(chips).toHaveLength(3);
    expect(chips.every((el) => el.classList.contains('ant-tag'))).toBe(true);
    expect(wrap.querySelectorAll('.ant-space-item')).toHaveLength(0);
    // 收缩契约：省略号 + 全名 title（空间不足时看到 `…` 而不是被削掉半个字）
    for (const chip of chips) {
      expect(chip.style.textOverflow).toBe('ellipsis');
      expect(chip.style.overflow).toBe('hidden');
      expect(chip.getAttribute('title')).toBeTruthy();
    }
    // 容器本身可收缩（flexShrink）且有兜底裁剪，不再是「定宽 + 隐藏滚动条」的静默截断
    expect(wrap.style.flexShrink).toBe('1');
    expect(wrap.style.overflow).toBe('hidden');
  });

  // 无 refs 时 chips 容器必须是空壳（「有就占位、没有就不占」）：Space 空子项返回 null，不留隐藏节点
  it('无 refs 时不渲染 chips 空壳', () => {
    render(<CommitGraph commits={[makeCommit({ hash: 'r0', message: '无引用' })]} />);
    expect(screen.getByTestId('commit-graph-refs')).toBeEmptyDOMElement();
  });

  it('空提交列表不渲染行', () => {
    render(<CommitGraph commits={[]} />);
    expect(screen.queryAllByTestId('commit-graph-row')).toHaveLength(0);
  });

  /**
   * 按需加载（「一路加载到最早一条」的 UI 侧闸门）：两个触发源——
   *   ① 已加载内容填不满视口（行数 × 24 ≤ height）：首次只来 50 条、窗口很高时列表根本滚不动，
   *      没有这一条就永远等不到滚动事件；
   *   ② 滚到距底部 3 行以内（几何只有滚动事件能拿到）。
   * 不变量：同一版数据（行数不变）只回调一次，避免「追加回来 → 副作用重跑 → 再请求同页」的连环请求。
   */
  describe('按需加载（onReachBottom）', () => {
    /**
     * jsdom 无布局：给 holder 造一份**恒定**的合成滚动几何再派发真实 scroll 事件。
     * scrollTop 用 getter/setter 固定住 —— jsdom 的 scrollTop setter 会按它自己的（空）几何把值夹回，
     * 而 rc-listy 内部还会把滚动位置写回该元素，直接赋值会被改掉，断言就失去判别力。
     */
    function scrollHolderTo(scrollTop: number): void {
      const holder = document.querySelector('.ant-listy-holder') as HTMLElement;
      Object.defineProperties(holder, {
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 100, configurable: true },
        scrollTop: { get: () => scrollTop, set: () => {}, configurable: true },
      });
      fireEvent.scroll(holder);
    }

    it('内容填不满视口时挂载即回调一次；同一版数据不重复回调', () => {
      const onReachBottom = vi.fn();
      // 6 行 × 24 = 144 ≤ 480（height 缺省）→ 视口没填满
      const { rerender } = render(<CommitGraph commits={mergeCommits} onReachBottom={onReachBottom} />);
      expect(onReachBottom).toHaveBeenCalledTimes(1);

      // 同一版数据重渲染（行数没变）：不再回调，避免同页重复请求
      rerender(<CommitGraph commits={mergeCommits} onReachBottom={onReachBottom} />);
      expect(onReachBottom).toHaveBeenCalledTimes(1);

      // 追加了一页但仍填不满视口 → 继续回调（这就是滚一次到底、逐页补到最早一条的链）
      const moreCommits: CommitInfo[] = [
        ...mergeCommits,
        ...Array.from({ length: 10 }, (_, i) => makeCommit({ hash: `x${i}` })),
      ];
      rerender(<CommitGraph commits={moreCommits} onReachBottom={onReachBottom} />);
      expect(onReachBottom).toHaveBeenCalledTimes(2);

      // 内容已经超出视口 → 不再自动补，交给滚动触发
      const filled: CommitInfo[] = [...moreCommits, ...Array.from({ length: 24 }, (_, i) => makeCommit({ hash: `y${i}` }))];
      rerender(<CommitGraph commits={filled} onReachBottom={onReachBottom} />);
      expect(onReachBottom).toHaveBeenCalledTimes(2);
    });

    it('滚到接近底部才回调；未到底不回调，到底后同一版数据不重复回调', () => {
      const onReachBottom = vi.fn();
      // height=100 < 6 行 × 24 = 144：内容撑满视口，故挂载时不回调（只有真实滚动才算「需要更早的提交」）
      render(<CommitGraph commits={mergeCommits} height={100} onReachBottom={onReachBottom} />);
      expect(onReachBottom).not.toHaveBeenCalled();

      // 距底部 100px（> 3 行 = 72px 的余量）→ 还不够近
      scrollHolderTo(800);
      expect(onReachBottom).not.toHaveBeenCalled();

      // 距底部 20px → 触发
      scrollHolderTo(880);
      expect(onReachBottom).toHaveBeenCalledTimes(1);

      // 仍停在底部、数据没变：不重复回调
      scrollHolderTo(900);
      expect(onReachBottom).toHaveBeenCalledTimes(1);
    });

    it('缺省 onReachBottom：滚到底也不回调（已到最早的提交，没有下一页）', () => {
      render(<CommitGraph commits={mergeCommits} height={100} />);
      expect(() => scrollHolderTo(900)).not.toThrow();
    });

    /**
     * 嵌入式宿主约束（用户口径）：高度判定只允许用**传入的 height 与 holder 自身几何**，
     * 不许读 window.innerHeight / 100vh —— 组件被嵌入到任意高度的宿主里时，
     * 视口高度与它实际能占的高度是两回事（实测：窗口 1600 高、宿主只有 459 高时，
     * 必须按 459 判「填不满」，而不是按 1600）。
     */
    it('高度判定不看视口高度：把 window.innerHeight 抬到远超内容，也不误判为「填不满」', () => {
      const onReachBottom = vi.fn();
      const original = Object.getOwnPropertyDescriptor(window, 'innerHeight');
      Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
      try {
        // height=100 < 6 行 × 24 = 144 → 内容撑满宿主；若实现里用了 window.innerHeight（4000），
        // 就会误判成「填不满」而在挂载时回调
        render(<CommitGraph commits={mergeCommits} height={100} onReachBottom={onReachBottom} />);
        expect(onReachBottom).not.toHaveBeenCalled();
      } finally {
        if (original) Object.defineProperty(window, 'innerHeight', original);
      }
    });
  });

  // 冒烟 F-021：?select=<hash> 深链与点击选中均需行级选中态（否则「选中哪一行」无从辨认）
  it('selectedHash 命中的行带选中底色，其余行无底色', () => {
    render(<CommitGraph commits={commits} selectedHash="c2" />);
    const rows = screen.getAllByTestId('commit-graph-row');
    const c2 = rows.find((r) => r.textContent?.includes('第二笔提交'));
    const c1 = rows.find((r) => r.textContent?.includes('初始提交'));
    expect(c2).toHaveAttribute('data-selected', 'true');
    expect(c1).not.toHaveAttribute('data-selected');
    expect(c1).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0)' });
  });

  /** ≥5 行分支合并图：c5 合并主线 c4 与侧支 c2b（含 c5→c2 跨行长边），c2b 落第二 lane */
  const mergeCommits: CommitInfo[] = [
    makeCommit({ hash: 'c5', parents: ['c4', 'c2b'], message: '合并侧支' }),
    makeCommit({ hash: 'c4', parents: ['c3'] }),
    makeCommit({ hash: 'c3', parents: ['c2'] }),
    makeCommit({ hash: 'c2', parents: ['c1'] }),
    makeCommit({ hash: 'c2b', parents: ['c1'], message: '侧支提交' }),
    makeCommit({ hash: 'c1', parents: [] }),
  ];

  it('每行渲染一个「整图视口」：viewBox 覆盖本行那条带，线段按全局坐标画', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    // 第 5 行（index 4）：viewBox 的 y 必须正好是 [4*24, 5*24)，与行盒 1:1 对齐
    const lane = within(rows[4]).getByTestId('commit-graph-lane');
    const svg = lane.querySelector('svg')!;
    const [, minY, , vbH] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(minY).toBe(4 * 24);
    expect(vbH).toBe(24);
    // 线段按全局坐标画：所有 y 必须落在全局 [0, 行数*24] 内，且至少有一条线
    const shapes = [...svg.querySelectorAll('line, polyline')];
    expect(shapes.length).toBeGreaterThan(0);
    const ys = shapes.flatMap((s) =>
      s.tagName === 'line'
        ? [Number(s.getAttribute('y1')), Number(s.getAttribute('y2'))]
        : (s.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[1])),
    );
    for (const y of ys) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(mergeCommits.length * 24);
    }
  });

  it('本行圆点画在本行中线，且该行线段的端点落在 lane 中心（竖线/斜线都接在竖线上）', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    // 第 5 行（index 4，侧支 c2b）：本行圆点 = 该行 SVG 里 cy = 4*24 + 12 的那个
    const svg = within(rows[4]).getByTestId('commit-graph-lane').querySelector('svg')!;
    const own = [...svg.querySelectorAll('circle')].find((c) => Number(c.getAttribute('cy')) === 4 * 24 + 12);
    expect(own).toBeTruthy();
    // lane 中心 x = (lane + 0.5) * 18；本行 c2b 的 lane 由布局给出，这里用圆点自身反查
    const ownX = Number(own!.getAttribute('cx'));
    expect((ownX - 9) % 18).toBe(0);
    // 存在一条线段从本行圆点出发（说明边接在圆点上、不是悬空的斜线）
    const shapes = [...svg.querySelectorAll('line, polyline')];
    const startsAtNode = shapes.some((s) => {
      if (s.tagName === 'line') {
        return Number(s.getAttribute('x1')) === ownX && Number(s.getAttribute('y1')) === 4 * 24 + 12;
      }
      const [x, y] = (s.getAttribute('points') ?? '').split(' ')[0].split(',').map(Number);
      return x === ownX && y === 4 * 24 + 12;
    });
    expect(startsAtNode).toBe(true);
  });

  /**
   * 每行图列宽度 = 本行带内所有线段与本行圆点的 x 上界（RowGeometry.maxX），且**文字起点必须让开线条**。
   * 两条口径都踩过坑：
   *   ① 旧口径按「本行圆点所在 lane」定宽 → 跨到更右 lane 的线被逐行 viewBox 裁断（实测断线 8px / 66px）；
   *   ② 只按「线落在 viewBox 内」定宽 → 线可画到列右缘，而列右缘比文字起点还靠右（负右边距的代价），
   *      实测线压住每行开头约 10px 文字。
   * 这里断言：所有坐标都在 viewBox 内，且都落在本行车道中心（= 文字起点 − DOT_GUTTER）左侧。
   */
  it('跨 lane 的边不被本行视口裁断，也不压到本行文字（文字让开最深的那条线）', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    rows.forEach((row) => {
      const lane = within(row).getByTestId('commit-graph-lane');
      const svg = lane.querySelector('svg')!;
      const [minX, , vbW] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const visibleRight = minX! + vbW!;
      // 视口宽度 = 图列宽度（1 用户单位 = 1px）
      expect(lane.style.width).toBe(`${vbW}px`);
      // 由列宽反解本行车道号：宽度 = (lane + 1) × 18 + 2 × 10
      const rowLane = (vbW! - 20) / 18 - 1;
      // 文字起点（全局坐标）= 车道中心 + DOT_GUTTER(8)（图列负右边距把文字拉到圆点右侧 8px）
      const textStartX = (rowLane + 0.5) * 18 + 8;
      const shapes = [...svg.querySelectorAll('line, polyline')];
      expect(shapes.length).toBeGreaterThan(0);
      const xs = shapes.flatMap((s) =>
        s.tagName === 'line'
          ? [Number(s.getAttribute('x1')), Number(s.getAttribute('x2'))]
          : (s.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[0])),
      );
      for (const x of xs) {
        expect(x).toBeLessThanOrEqual(visibleRight);
        expect(x).toBeLessThanOrEqual(textStartX);
      }
      // 圆点（中心 + 半径 24/6）也要完整可见
      const cx = Number(svg.querySelector('circle')!.getAttribute('cx'));
      expect(cx + 24 / 6).toBeLessThanOrEqual(visibleRight);
    });
  });

  /** 每行只画本行带内的切片 + 本行圆点（旧实现每行都重画整张图，再把多余部分靠视口裁掉） */
  it('每行只渲染本行的内容：一个圆点，且线段数远小于全图线段数', () => {
    render(<CommitGraph commits={mergeCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    const allShapes = rows.flatMap((row) => [
      ...within(row).getByTestId('commit-graph-lane').querySelectorAll('line, polyline'),
    ]);
    // 每行一个圆点（旧实现是「行数 × 圆点数」）
    for (const row of rows) {
      expect(within(row).getByTestId('commit-graph-lane').querySelectorAll('circle')).toHaveLength(1);
    }
    // 旧实现下每行都会画全图所有切片（行数 × 全图切片数），这里按行求和不会超过全图切片数
    expect(allShapes.length).toBeLessThanOrEqual(mergeCommits.length * 6);
  });
});
