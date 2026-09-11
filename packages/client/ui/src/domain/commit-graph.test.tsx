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

  // 多个 ref chip 之间的间距（用户口径 4px，视觉上更紧凑）：chips 之间的空隙由 antd Space 的档位类名统一给。
  // 关键不变量：每个 chip 必须是 Space 的**直接子项**（Space 只对直接子项加间距；
  // 若用一个 Fragment 把全部 chip 包成一坨，Space 只看到 1 个子项 → chip 之间一个像素都不会有）。
  it('多个 chip 之间的间距走 antd Space 档位：每个 chip 一个直接子项', () => {
    const withRefs: CommitInfo[] = [
      makeCommit({ hash: 'r1', refs: ['main', 'feature', 'tag: v1.0'], message: '多引用' }),
    ];
    render(<CommitGraph commits={withRefs} showTags />);
    const wrap = screen.getByTestId('commit-graph-refs');
    const space = wrap.firstElementChild as HTMLElement;
    expect(space.className).toContain('ant-space');
    expect(space.className).toContain('ant-space-gap-col-small');
    // 间距既不写内联、也不靠 chip 自己的 margin（antd v6 的 Tag 无默认 margin，实测 0）
    expect(space.style.columnGap).toBe('');
    expect(space.style.rowGap).toBe('');
    // 口径锚点：small 档 = 主题 `paddingXS` token，紧凑密度下恰为 4px
    // （与说明区 Flex 的 `middle` = `padding` = 8px 是两个档位，互不影响）
    expect(theme.getDesignToken(compactTheme('light')).paddingXS).toBe(4);
    expect(theme.getDesignToken(compactTheme('dark')).paddingXS).toBe(4);
    // 3 个 chip（main / feature / v1.0）→ 3 个非空子项，每个子项恰好 1 个 chip
    const items = [...space.children].filter(
      (el) => el.classList.contains('ant-space-item') && el.firstElementChild !== null,
    );
    expect(items).toHaveLength(3);
    expect(items.map((it) => it.children.length)).toEqual([1, 1, 1]);
    expect(wrap.querySelectorAll('.ant-space-item > .ant-tag')).toHaveLength(3);
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
});
