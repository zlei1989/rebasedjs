import { fireEvent, render, screen, within } from '@testing-library/react';
import { theme } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@rebased/contracts';
import { CommitGraph, type CommitGraphProps } from './commit-graph';
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

  // 作者/日期两列**始终渲染**（2026-09-20 用户口径：删除隐藏策略）。
  // 改前由 `showAuthor` / `showDate` 两个 prop 按「日志栏实测宽度 ≥ 512」整列显隐，且两列合计 272px
  // 定宽；现在这两个 prop 已从 `CommitGraphProps` 删除，**没有任何开关能关掉它们**。
  // 本用例是负向守卫：谁把开关加回来（重新引入条件渲染），这里立刻变红。
  it('作者/日期始终渲染：每行都有这两列，且无 prop 可关掉', () => {
    render(<CommitGraph commits={commits} />);
    expect(screen.getAllByText('Alice')).toHaveLength(3);
    expect(screen.getAllByText('2026-09-01 14:30')).toHaveLength(3);
    // 逐行都在（不是「整体命中 ≥1」）：3 行 × 两列
    const rows = screen.getAllByTestId('commit-graph-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(within(row).getByTestId('commit-graph-author')).toBeInTheDocument();
      expect(within(row).getByTestId('commit-graph-date')).toBeInTheDocument();
    }
    // 两列可压缩但**不可被隐藏**：压缩靠省略号，不靠 display/visibility 的花招
    for (const el of rows.flatMap((row) => [
      within(row).getByTestId('commit-graph-author'),
      within(row).getByTestId('commit-graph-date'),
    ])) {
      expect(el.style.display).toBe('');
      expect(el.style.visibility).toBe('');
      expect(el.hidden).toBe(false);
    }
    // 编译期守卫：接口上已无这两个 prop。
    // @ts-expect-error showAuthor 已删除（删除隐藏策略）；若它被加回接口，这行会变成「多余」而报错
    void ({} as CommitGraphProps).showAuthor;
    // @ts-expect-error showDate 已删除（同上）
    void ({} as CommitGraphProps).showDate;
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

  // 行内间距口径：横向各段的间距**一律来自 antd Flex 的档位类名**，组件与调用点都不写内联 gap。
  //
  // 结构（2026-09-20 用户口径）：作者/日期进「行内容区」（`commit-graph-message`）后，
  // 主题 + refs chips 又被收进**内层** Flex（主题组）——故间距分两级、两个档位：
  //   · 内层（主题 ↔ chips）  = `gap="small"` = `paddingXS` = 4px；
  //   · 外层（主题组 ↔ 作者 ↔ 日期）= `gap="middle"` = `padding` = 8px。
  // 两个档位必须各锁一条，否则「内层档位被改/被去掉」只会表现为间距变化，测试全绿：
  // 去掉内层 Flex 后主题与 chips 变成外层的直接子项，间距会从 4px **静默变成 8px**。
  // 内联 gap 的禁令覆盖整棵子树（外层 + 内层 + chips 行 + 作者/日期）。
  it('行内容区不写内联间距：外层 8px / 内层 4px 都由 antd Flex 的档位类名提供', () => {
    render(<CommitGraph commits={commits} />);
    const row = screen.getAllByTestId('commit-graph-row')[0];
    const box = within(row).getByTestId('commit-graph-message');
    // 不变量：该子树里任何元素都不得用内联 gap/columnGap/rowGap 表达间距
    const inlineGap = [...box.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.style.gap !== '' || el.style.columnGap !== '' || el.style.rowGap !== '',
    );
    expect(inlineGap.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    // 机制：间距与交叉轴居中都由类名提供（gap=middle → .ant-flex-gap-middle）
    expect(box.className).toContain('ant-flex-gap-middle');
    expect(box.className).toContain('ant-flex-align-center');
    // 内层主题组：同类机制、另一档位
    const messageGroup = box.children[0] as HTMLElement;
    expect(messageGroup.className).toContain('ant-flex-gap-small');
    // 口径锚点：middle 档 = 主题 `padding` token、small 档 = `paddingXS`，
    // 而全站默认密度为紧凑（PageShell → base/density.ts 的 compactAlgorithm）——8px / 4px 才成立。
    // 谁动了 density.ts 的间距 token、或把该行挂到非紧凑子树下，这里立刻变红。
    expect(theme.getDesignToken(compactTheme('light')).padding).toBe(8);
    expect(theme.getDesignToken(compactTheme('dark')).padding).toBe(8);
    expect(theme.getDesignToken(compactTheme('light')).paddingXS).toBe(4);
    expect(theme.getDesignToken(compactTheme('dark')).paddingXS).toBe(4);
  });

  // 结构口径（2026-09-20 用户明确「三个节点用一个 div 包裹」）：主题 / 作者 / 日期三层同处一个柔性容器；
  // 作者/日期**直接是它的子项**——档位 gap 只作用于直接子项，隔一层包装就一个像素的间距都拿不到。
  // 改前作者/日期是「行」的兄弟节点（容器之外），与说明区之间没有任何间距来源。
  // 容器子项恰为 3 个：主题组（主题 + refs chips 的内层 Flex）+ 作者 + 日期。
  it('主题 / 作者 / 日期同处一个柔性容器，且都是它的直接子项', () => {
    render(<CommitGraph commits={commits} />);
    const row = screen.getAllByTestId('commit-graph-row')[0];
    const box = within(row).getByTestId('commit-graph-message');
    const author = within(row).getByTestId('commit-graph-author');
    const date = within(row).getByTestId('commit-graph-date');
    // 三者在同一个容器内（作者/日期不再是「行」的直接子节点）
    expect(box.contains(author)).toBe(true);
    expect(box.contains(date)).toBe(true);
    // 主题组：主题文字 + refs chips 在内层 Flex 里（chips 不再是外层容器的直接子项）
    const messageGroup = box.children[0] as HTMLElement;
    expect(messageGroup.className).toContain('ant-flex');
    expect(messageGroup.children[0].textContent).toBe('合并 feature 分支');
    expect(messageGroup.children[1]).toBe(within(row).getByTestId('commit-graph-refs'));
    // 外层容器的直接子项：主题组 / 作者 / 日期（chips 已下沉一层）
    expect(box.children).toHaveLength(3);
    expect(box.children[1]).toBe(author);
    expect(box.children[2]).toBe(date);
    // 主题组承接「适配所有剩余宽度」：grow 1 + minWidth 0（只剩内容宽度就吃不下剩余宽度了）
    expect(messageGroup.style.flexGrow).toBe('1');
    expect(messageGroup.style.minWidth).toBe('0px');
    expect(box.style.flexGrow).toBe('1');
    expect(box.style.minWidth).toBe('0px');
    // **flex-basis 必须是 auto，不能是 0%（即不能写成 `flex: 1`）**：flex 的收缩份额按
    // `flex-basis × flex-shrink` 加权分配，basis 为 0 的项份额为 0 → 作者/日期永远不会被压缩，
    // 它们的省略号样式静默失效（实测 520px 行宽下作者列恒为满宽 70px，改为 auto 后 42px）。
    // 这是「宽度不足时作者和时间也出省略号」这条口径的唯一支点，故单列一条断言钉住它。
    expect(messageGroup.style.flexBasis).toBe('auto');
    expect(box.style.flexBasis).toBe('auto');
    expect(messageGroup.style.flexShrink).toBe('1');
    expect(box.style.flexShrink).toBe('1');
    // 作者/日期已从「行」的直接子节点移走：行上只剩图列 + 本容器（否则又会多出一条无间距来源的兄弟）
    expect([...row.children]).toEqual([within(row).getByTestId('commit-graph-lane'), box]);
  });

  // 宽度口径（用户明确「紧凑内容宽度」）：作者/日期不再钉死 144/128px，改为按内容宽度，
  // 上限保留原值（只作超长兜底），且仍可被压缩——压缩下限为 0，故必须有省略号承接。
  it('作者/日期按内容宽度（不再定宽），保留上限与省略号', () => {
    render(<CommitGraph commits={commits} />);
    const row = screen.getAllByTestId('commit-graph-row')[0];
    const author = within(row).getByTestId('commit-graph-author');
    const date = within(row).getByTestId('commit-graph-date');
    for (const [el, ceiling] of [
      [author, '144px'],
      [date, '128px'],
    ] as const) {
      // 无固定 width（定宽即失去「内容宽度」语义），上限只作超长兜底
      expect(el.style.width).toBe('');
      expect(el.style.maxWidth).toBe(ceiling);
      // 不抢剩余宽度（剩余宽度归主题），宽度按内容：flex-grow 0 + flex-basis auto
      expect(el.style.flexGrow).toBe('0');
      expect(el.style.flexBasis).toBe('auto');
      // 仍可被压缩（用户选择「按内容宽度、仍可被压缩」）
      expect(el.style.flexShrink).toBe('1');
      expect(el.style.minWidth).toBe('0px');
      // 压缩后不能硬切半个字
      expect(el.style.overflow).toBe('hidden');
      expect(el.style.textOverflow).toBe('ellipsis');
    }
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

  /**
   * 显示车道压实（graph-layout/lane-compaction）必须挂在渲染链路上：
   * Java 车道按 fragment 发现顺序发号且永不复用，侧支因此常被放到靠右的列（本 fixture 里是车道 2），
   * 压实后应回到「并存线数 − 1」档 —— 主仓 rebased-smoke 的最大缩进由此从 3 档降到 1 档。
   */
  it('稀疏车道被压实到结构深度：全表列宽不超过 1 档（不出现 74px/92px 的空档行）', () => {
    /** 复刻主仓形态：两条侧支时间上错开（s1 跨度 [2,2]、s2 跨度 [6,7]），Java 侧支车道分别是 2 与 1 */
    const sparseLaneCommits: CommitInfo[] = [
      makeCommit({ hash: 'm1', parents: ['p1', 's1'], message: '合并侧支' }),
      makeCommit({ hash: 'p1', parents: ['p2'] }),
      makeCommit({ hash: 's1', parents: ['p2'], message: '侧支一' }),
      makeCommit({ hash: 'p2', parents: ['p3'] }),
      makeCommit({ hash: 'p3', parents: ['p4', 's2'], message: '合并第二条侧支' }),
      makeCommit({ hash: 'p4', parents: ['p5'] }),
      makeCommit({ hash: 'p5', parents: ['p6'] }),
      makeCommit({ hash: 's2', parents: ['p6'], message: '侧支二' }),
      makeCommit({ hash: 'p6', parents: [] }),
    ];
    render(<CommitGraph commits={sparseLaneCommits} />);
    const rows = screen.getAllByTestId('commit-graph-row');
    const widths = rows.map((row) => within(row).getByTestId('commit-graph-lane').style.width);
    // 未压实：s1 所在行的圆点在车道 2 → 74px；压实后至多 1 档 → 38px / 56px
    expect([...new Set(widths)].sort()).toEqual(['38px', '56px']);
  });

  // 线性折叠（设计 §3.5）：点圆点折叠整条链、点虚线展开、且命中图元不改变选中提交
  describe('线性折叠', () => {
    const chain: CommitInfo[] = [
      makeCommit({ hash: 'a', parents: ['b'], message: 'a' }),
      makeCommit({ hash: 'b', parents: ['c'], message: 'b' }),
      makeCommit({ hash: 'c', parents: ['d'], message: 'c' }),
      makeCommit({ hash: 'd', parents: [], message: 'd' }),
    ];

    it('点击圆点折叠链：中间行消失，产生虚线边', () => {
      const onCollapseChange = vi.fn();
      render(<CommitGraph commits={chain} collapsed={[]} onCollapseChange={onCollapseChange} />);
      fireEvent.click(screen.getByTestId('graph-node-a'));
      expect(onCollapseChange).toHaveBeenCalledWith([{ up: 'a', down: 'd' }]);
    });

    it('受控折叠后只渲染两端行，并出现可命中的虚线边', () => {
      render(<CommitGraph commits={chain} collapsed={[{ up: 'a', down: 'd' }]} onCollapseChange={() => {}} />);
      expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(2);
      expect(screen.getByText('a')).toBeInTheDocument();
      expect(screen.getByText('d')).toBeInTheDocument();
      expect(screen.queryByText('b')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('graph-edge-hit-0-1')[0]).toBeInTheDocument();
    });

    it('点击折叠虚线边展开（回调收到空数组）', () => {
      const onCollapseChange = vi.fn();
      render(<CommitGraph commits={chain} collapsed={[{ up: 'a', down: 'd' }]} onCollapseChange={onCollapseChange} />);
      fireEvent.click(screen.getAllByTestId('graph-edge-hit-0-1')[0]);
      expect(onCollapseChange).toHaveBeenCalledWith([]);
    });

    // brief 的用例只覆盖「点圆点」与「点折叠虚线边」，这里补上第三种命中图元：普通实线边
    // （走 fragmentForEdge 取边所在链，而不是圆点那条 linearFragmentAt 路径）
    it('点击普通实线边折叠其所在链', () => {
      const onCollapseChange = vi.fn();
      render(<CommitGraph commits={chain} collapsed={[]} onCollapseChange={onCollapseChange} />);
      // 未折叠时 a→b 这条实线的命中带（端点行号 0→1，该边在上下两行各有一片）
      fireEvent.click(screen.getAllByTestId('graph-edge-hit-0-1')[0]);
      expect(onCollapseChange).toHaveBeenCalledWith([{ up: 'a', down: 'd' }]);
    });

    it('命中图元不触发 onSelect（对齐 Java shouldSelectCell）', () => {
      const onSelect = vi.fn();
      const onCollapseChange = vi.fn();
      render(<CommitGraph commits={chain} onSelect={onSelect} collapsed={[]} onCollapseChange={onCollapseChange} />);
      fireEvent.click(screen.getByTestId('graph-node-a'));
      expect(onSelect).not.toHaveBeenCalled();
      // 行正文点击仍然选中
      fireEvent.click(screen.getByText('b'));
      expect(onSelect).toHaveBeenCalledWith('b');
    });

    it('悬停圆点高亮整条链的圆点（含端点）', () => {
      render(<CommitGraph commits={chain} collapsed={[]} onCollapseChange={() => {}} />);
      // mouseOver 触发 React 的 onMouseEnter（见 base/graph-canvas.test.tsx 同处注释）
      fireEvent.mouseOver(screen.getByTestId('graph-node-b'));
      expect(screen.getByTestId('graph-node-ring-a')).toBeInTheDocument();
      expect(screen.getByTestId('graph-node-ring-d')).toBeInTheDocument();
    });

    it('无 onCollapseChange 时不折叠（缺省行为与现状一致）', () => {
      render(<CommitGraph commits={chain} />);
      fireEvent.click(screen.getByTestId('graph-node-a'));
      expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(4);
    });
  });

  // 分支过滤（设计 §3.6）：过滤激活时折叠入口失效，图只留可达行
  describe('分支过滤', () => {
    const branchy: CommitInfo[] = [
      makeCommit({ hash: 'a', parents: ['b'], refs: ['HEAD -> main'], message: 'a' }),
      makeCommit({ hash: 'b', parents: ['c'], message: 'b' }),
      makeCommit({ hash: 'c', parents: [], refs: ['side'], message: 'c' }),
      makeCommit({ hash: 'x', parents: ['c'], refs: [], message: 'x' }),
    ];

    it('选中分支后只渲染可达行', () => {
      render(<CommitGraph commits={branchy} branches={['side']} />);
      // side 的锚点行 c(2) 及其父（无）→ 只剩 c
      expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(1);
      expect(screen.getByText('c')).toBeInTheDocument();
    });

    it('过滤激活时点圆点不折叠', () => {
      const onCollapseChange = vi.fn();
      render(<CommitGraph commits={branchy} branches={['main']} onCollapseChange={onCollapseChange} />);
      fireEvent.click(screen.getByTestId('graph-node-a'));
      expect(onCollapseChange).not.toHaveBeenCalled();
    });
  });
});
