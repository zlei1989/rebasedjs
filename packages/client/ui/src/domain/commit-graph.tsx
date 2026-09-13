/**
 * 提交图：graph-layout 布局 + 虚拟滚动渲染 + 选中回调。
 *
 * 渲染口径（2026-09-12 重构，修「垂直线不闭合 / 斜线接不上主竖线 / 缩进不随线条」；
 *   同日二次修「分叉点挂在无关提交上 / 跨行线被逐行视口裁断」，几何口径见 domain/commit-graph-segments 文件头）：
 *   - **全图一套全局坐标**：x = laneCenterX(lane)，y = rowCenterY(行号)（见 base/graph-canvas）；
 *   - 线段只编译一次并按行切好（domain/commit-graph-segments，纯函数可单测）：
 *     竖段与斜段都在行边界处切开，相邻两行画出的两半共享同一个端点坐标，行边界处严丝合缝；
 *   - 每行渲染一块 SVG，**只画落在本行带内的切片与本行圆点**（旧实现每行都重画整张图再靠视口裁掉，
 *     大仓会把 DOM 撑到几万节点）；viewBox = 本行带 × 本行图列宽度，不做「按行裁切拼接」；
 *   - 本行图列宽度 = 本行带内所有线条与本行圆点的 x 上界（`RowGeometry.maxX`）→
 *     跨到更右 lane 的斜线不会再被裁断（旧口径按「本行圆点所在 lane」定宽，实测断线 8px / 66px）；
 *   - **车道号先经显示层压实**（graph-layout/lane-compaction）：Java 车道是 fragment 发现顺序、永不复用，
 *     侧支因此常被放到靠右的列、中间留空列；压实后「同时并存的线」连续编号，缩进深度才等于结构深度
 *     （主仓实测最大缩进 3 档 → 1 档；车道本就稠密的仓库是恒等变换）。颜色/parity 仍走 Java lane。
 *   - 说明文字的缩进 = 本行图列预留的 lane 列数 × LANE_WIDTH，**随线条缩进**
 *     （线条画到更右的车道，本行文字就跟着让位；没画到右边的行，缩进与旧口径逐像素一致）。
 *
 * UX 对齐 #2：行默认列为 Subject（图 + refs chips）+ Author + Date（Hash 列省）；
 * 分支 chips 默认开，tag chips 默认关（对齐 Java showTagNames=false），由 showTags 打开。
 *
 * 间距口径（2026-09-12）：说明区内的间距**一律不写内联 gap / 自定义 class**，由 antd `Flex` 的档位给
 *   （`gap="middle"` = 主题 `padding` token；全站默认紧凑密度下恰为 8px，见下方说明区注释与测试锚点）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider, Flex, Listy, Tag, theme, Typography } from 'antd';
import type { ThemeConfig } from 'antd';
import type { CommitInfo } from '@rebased/contracts';
import { buildLayout, compactLanes, applyGraphView, fragmentForEdge, linearFragmentAt, type CollapsedFragment, type LayoutCommit } from '../graph-layout';
import { colorForRef } from '../graph-layout/color';
import { GraphCanvas, laneCenterX } from '../base/graph-canvas';
import { buildRowGeometry, laneCoveringX } from './commit-graph-segments';
import { classifyRefs } from './refs';
import { formatCommitDate } from './format';

export interface CommitGraphProps {
  commits: CommitInfo[];
  onSelect?: (hash: string) => void;
  /** 行右键回调（LogPage 受控菜单挂接：右键行 → 记录 hash，DropDown contextMenu 展示）；缺省不绑定 */
  onContextMenu?: (hash: string) => void;
  height?: number;
  /** tag chips 开关（默认 false，对齐 Java VcsLogApplicationSettings.showTagNames） */
  showTags?: boolean;
  /** 选中行高亮（详情面板当前提交；`?select=<hash>` 深链与点击选中均经此呈现选中态） */
  selectedHash?: string | null;
  /** 分支过滤选中的分支名；空/缺省 = 不过滤（视图与现状逐像素一致） */
  branches?: string[];
  /** 已折叠的线性链（受控）；缺省 = 无折叠 */
  collapsed?: CollapsedFragment[];
  /** 折叠状态变更（折叠/展开均经此回写）；缺省 = 图元命中不产生折叠 */
  onCollapseChange?: (next: CollapsedFragment[]) => void;
  /**
   * 需要更早的提交时回调（按需加载：滚到接近底部，或已加载内容还填不满视口）。
   * 缺省不触发（= 已到最早的提交，没有下一页）。同一版数据只回调一次：追加出新数据后若仍未填满
   * 视口会再回调一次，因此「一次滚动到底 → 逐页追加直到最早一条可见」能自动完成。
   *
   * 高度口径（嵌入式宿主约束）：判定只用**传入的 `height` 与滚动容器自身的几何**，
   * 绝不读 `window.innerHeight` / `100vh` —— 本组件会被嵌进各种宿主（工具窗口、分栏、面板），
   * 视口高度与它真正能占的高度不是一回事。故调用方给多少高度，就按多少高度判「填不满」。
   */
  onReachBottom?: () => void;
}

const ROW_HEIGHT = 24;
const LANE_WIDTH = 18;
/**
 * 空数组常量：`useMemo` 的依赖用的是数组**引用**，而调用方常传内联字面量（`[]`）或可选 prop 的缺省值——
 * 缺省值若写成 `branches = []` 每次渲染都是新引用，会把下面这步全量布局重算在父组件每次渲染时都跑一遍
 * （列表滚动时白白重算整图 lane 分配）。故缺省指向模块级常量。
 */
const EMPTY_BRANCHES: string[] = [];
const EMPTY_COLLAPSED: CollapsedFragment[] = [];
/**
 * 触底判定的余量（3 行）：滚到距底部 3 行以内就算「该要下一页了」，
 * 让下一页在用户真正撞到底之前就在路上，避免每次到底都要停一下再补。
 */
const REACH_BOTTOM_THRESHOLD = ROW_HEIGHT * 3;
/**
 * 图列左右留白：不留会让最左/最右 lane 的圆点被视口边缘切掉。
 * 注意它会进入「圆点中心 → 图列右边界」的距离（= GRAPH_PADDING_X + LANE_WIDTH/2），
 * 该距离又被图列的负右边距抵消，见 laneMarginRight。
 */
const GRAPH_PADDING_X = 10;
/**
 * 说明文字与**本行圆点中心**的间距（用户口径：8px）。
 * 换算：图列宽度 = (lane+1) × LANE_WIDTH + 2×GRAPH_PADDING_X，圆点中心距图列右边界恒为
 * GRAPH_PADDING_X + LANE_WIDTH/2，故给图列一个负右边距把说明拉近：
 *   laneMarginRight = DOT_GUTTER − (GRAPH_PADDING_X + LANE_WIDTH/2)
 * 实测该口径下「文字距圆点中心」在所有 lane、所有 4 个仓库都是同一个值（不受 lane 数影响）。
 */
const DOT_GUTTER = 8;
/**
 * refs（分支/标签 chip）列宽上限。
 *
 * 旧口径 140px 会把常见情形直接切掉（实测 1440px 窗口下：3 个 chip 的真实宽度 295px，
 * 140px 容器 + `scrollbarWidth: none` → 第 3 个 chip 一个像素都看不见，第 2 个只剩半边，
 * 且**没有任何截断提示**）。现在改成「先给足、再逐 chip 省略号」：
 *   - 上限放宽到能容下 3~4 个常见分支名（320px）；
 *   - 容器可收缩（flexShrink + minWidth 0），窗口变窄时先压缩 chips 而不是硬切；
 *   - 每个 chip 自己带 `overflow: hidden + ellipsis` 与 `title`（全名 tooltip）——
 *     空间真的不够时看到的是省略号与 tooltip，而不是被削掉一半的字。
 */
const REF_COLUMN_WIDTH = 320;

/**
 * antd Listy 的「估算行高」口径（**必须与真实行高逐像素相等**，否则列表会出现「滚下去几条不显示」）。
 *
 * 问题（浏览器实测，2026-09-12）：antd 的 Listy 把 `itemHeight` 从入参里 Omit 掉了、传进去也会被内部覆盖，
 * 它只按 token 现算：`itemHeight = fontHeight + (itemPaddingBlock ?? paddingSM) × 2`
 * （antd `es/listy/index.js`）。全站紧凑密度下这条式子给出 20 + 8 × 2 = **36px**，而本页每行写死
 * ROW_HEIGHT = **24px**（与图的 24px 行距、GraphCanvas 的行切片对齐，不能改）。
 * 虚拟窗口因此按 36px 折算「视口里该渲染多少行」：窗口高 839px 时只算 839/36 ≈ 23 行 × 24px = 552px，
 * 视口底部整片空着（实测滚动中空带 146~191px）——表现就是往下滚时「接下来几条迟迟不出现」，
 * 要继续滚才补上；同时内容总高按 36px/行虚高 50%，滚动条比例与位置也对不上。
 *
 * 修法：在**图这一棵子树**内覆盖 Listy 的 `itemPaddingBlock`（唯一能影响上式的公开组件 token），
 * 让估算行高恰好落在 ROW_HEIGHT 上。fontHeight 由 antd 在运行时生成（`genFontMapToken`），
 * 但 6.6.3 的 `AliasToken` 类型里没有声明它，故按运行时口径窄化读取——这样密度主题一变，
 * 补偿值随之自算，不会硬编码出一个立刻过期的常数。
 *
 * 为什么不放进 base/density.ts 的全站主题：那是所有 Listy 共用的，其它面板的行高就是 token 默认值
 * （36px），一刀切改 itemPaddingBlock 会把它们的行内边距一起去掉。
 * 为什么覆盖 itemPaddingBlock 不影响本页视觉：Listy 只用它做 `.ant-listy-item` 的纵向内边距，
 * 而本页行内边距已被调用点的 `styles={{ item: { padding: 0 } }}` 归零（行高恒 24px），
 * 组件 token 的这点 padding 落不到行上。
 */
function listyRowHeightTheme(fontHeight: number): ThemeConfig {
  // 反解 antd 公式：fontHeight + 2 × itemPaddingBlock = ROW_HEIGHT。
  // 夹到 0：宽松密度下 fontHeight 可能已大于 ROW_HEIGHT，此时不再补偿（估算略大于真实，仅剩小偏差）。
  const itemPaddingBlock = Math.max(0, (ROW_HEIGHT - fontHeight) / 2);
  return { components: { Listy: { itemPaddingBlock } } };
}

/**
 * 单行 refs chips：分支 chip 底色 = 该分支名的图列色（colorForRef，ref 名 hash → HSB 色板），
 * 与图车道颜色同源——同一分支在图中与 chip 上恒定同色（Java 分支标签着色的等价承载）。
 * 注意「同色」要求两边用**同一个 ref 名**：图列侧用 graph-layout/ref-name 的 refNameOf 剥掉
 * `HEAD -> ` 前缀后再哈希，chips 侧由 classifyRefs（同一个实现）给出分支名，缺一边就会异色。
 * 标签 chip 保持橙色预设色（tag 不参与分支着色）。
 *
 * 多个 chip 之间的间距（用户口径 4px，视觉上更紧凑）：由 antd `Flex` 的 `gap="small"` 档位类名统一给
 * （`.ant-flex-gap-small` = 组件 token `flexGapSM` = 主题 `paddingXS` token，紧凑密度下 4px；
 * 与说明区 Flex 的 `gap="middle"`（= `padding` = 8px）是两个独立档位，互不影响）。
 * 为什么是 `Flex` 而不是原来的 `Space`：`Space` 会把每个 child 包一层 `div.ant-space-item`（min-width: auto，
 * 不可收缩），chips 装不下时只能被容器硬切；`Flex` 下 chip 自身就是 flex item，`overflow: hidden`
 * 使其最小尺寸归零 → 空间不足时芯片**自己省略号**（配合 `title` 显示全名），不再出现「半截字」。
 * 注意两点，否则「间距会静默消失」：
 *   1. `Flex` 的 gap 只作用于**直接子项** —— 必须把 chips 摊平成数组直接交给它，
 *      不能用一个 Fragment 把全部 chip 包成一坨（那样只有一个子项，chip 之间一个像素都没有）；
 *   2. 不写内联 `gap` / 不给 `Tag` 加 margin（antd v6 的 Tag 本就无默认 margin，实测 0，
 *      故档位间距不会被叠加成两份）。
 * 无 refs 时返回 null（不留空壳 DOM）。
 */
function RefChips({ refs, showTags }: { refs: string[]; showTags: boolean }): React.ReactNode {
  // chip 文字色走主题 token（原 #fff 为硬编码，亮/暗主题下都用「实色底 + 反白字」）
  const { token } = theme.useToken();
  const { branches, tags } = classifyRefs(refs);
  /** chip 通用样式：可收缩 + 省略号（空间不足时看到 `…`，hover 由 title 给出全名） */
  const chipStyle: React.CSSProperties = {
    // 不设 marginInlineEnd：与说明文字的间距由说明区 Flex 的 gap 统一给（用户口径 8px）
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    verticalAlign: 'middle',
  };
  // 摊平成一个数组：分支 chips 在前、标签 chips 在后（顺序与 classifyRefs 的分类一致）。
  // key 加前缀：两类 chip 现在同处一个 children 数组，避免「分支名与标签名同名」时 key 撞车。
  const chips = [
    ...branches.map((b) => (
      <Tag
        key={`branch:${b}`}
        data-testid={`ref-chip-${b}`}
        title={b}
        style={{
          ...chipStyle,
          backgroundColor: colorForRef(b),
          borderColor: 'transparent',
          color: token.colorTextLightSolid,
        }}
      >
        {b}
      </Tag>
    )),
    ...(showTags
      ? tags.map((t) => (
        <Tag key={`tag:${t}`} title={t} style={chipStyle} color="orange">
          {t}
        </Tag>
      ))
      : []),
  ];
  if (chips.length === 0) return null;
  return <Flex gap="small">{chips}</Flex>;
}

export function CommitGraph({
  commits,
  onSelect,
  onContextMenu,
  height = 480,
  showTags = false,
  selectedHash = null,
  branches = EMPTY_BRANCHES,
  collapsed = EMPTY_COLLAPSED,
  onCollapseChange,
  onReachBottom,
}: CommitGraphProps): React.ReactNode {
  // 日期列用主题次要文本色（原 #888 是暗色专用硬编码，明亮主题下对比不足）
  const { token } = theme.useToken();
  const layoutCommits: LayoutCommit[] = useMemo(
    () => commits.map((c) => ({ hash: c.hash, parents: c.parents, refs: c.refs })),
    [commits],
  );
  // delegate 图 → 视图变换（过滤/折叠）→ 显示车道压实。
  // applyGraphView 是渲染前唯一变换点：删隐藏行、裁边、重映射行号、注入虚线边（见 graph-layout/graph-view）。
  // 注意**只以 view.rows 为准**做渲染决策：view.visible/hidden 在折叠态并不互补（非过滤态 visible 是全部
  // delegate 行，而折叠区间行又进了 hidden），读它会把已折叠的中间行画出来。
  const view = useMemo(() => applyGraphView(buildLayout(layoutCommits), branches, collapsed), [layoutCommits, branches, collapsed]);
  const rows = useMemo(() => compactLanes(view.rows), [view]);
  // 每行要画的线段切片 + 本行图列必须覆盖的 x 上界（跨行长边由编译层按行边界切分，
  // 见 domain/commit-graph-segments：旧实现按「本行圆点所在 lane」定宽，跨 lane 的斜线会被视口裁断）
  const rowGeometry = useMemo(() => buildRowGeometry(rows, ROW_HEIGHT, LANE_WIDTH), [rows]);
  // hash → 原始提交（LayoutCommit 只带图字段，行渲染需要 author/date/message）
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c] as const)), [commits]);
  // antd 的 fontHeight 是运行时 token（genFontMapToken 生成），6.6.3 的类型里没有声明它，
  // 而 Listy 内部算 itemHeight 读的正是同一个值，故这里按运行时口径窄化读取（缺失时按紧凑密度实测值 20）。
  const fontHeight = (token as { fontHeight?: number }).fontHeight ?? 20;
  const listyTheme = useMemo(() => listyRowHeightTheme(fontHeight), [fontHeight]);
  // 按需加载的触发条件之一：滚到接近底部（几何只有滚动事件能拿到，故由 onScroll 上报）
  const [atBottom, setAtBottom] = useState(false);
  // 悬停高亮的可见行号集合（线性链高亮：锚点所在链的全部节点）
  const [highlight, setHighlight] = useState<Set<number>>(new Set());
  // 过滤激活时图动作全部失效（对齐 Java FilteredController.performAction = null 与
  // VisibleGraphImpl.isActionSupported 对 BUTTON_COLLAPSE 的判定）
  const graphActionsEnabled = branches.length === 0 && onCollapseChange !== undefined;
  /** 折叠/展开的可折叠链：hash 对 → 回写受控状态 */
  const toggleCollapse = (fragment: CollapsedFragment, collapse: boolean): void => {
    if (!graphActionsEnabled) return;
    const exists = collapsed.some((f) => f.up === fragment.up && f.down === fragment.down);
    if (collapse && exists) return;
    if (!collapse && !exists) return;
    onCollapseChange?.(collapse ? [...collapsed, fragment] : collapsed.filter((f) => !(f.up === fragment.up && f.down === fragment.down)));
  };
  /** 悬停锚点行 → 高亮其所在链的全部可见行；无链则清空高亮 */
  const hoverChain = (anchorRow: number): void => {
    if (!graphActionsEnabled) {
      setHighlight(new Set());
      return;
    }
    const fragment = linearFragmentAt(rows, anchorRow);
    if (fragment === null) {
      setHighlight(new Set());
      return;
    }
    const startRow = rows.findIndex((r) => r.commit.hash === fragment.up);
    const endRow = rows.findIndex((r) => r.commit.hash === fragment.down);
    const next = new Set<number>();
    for (let i = Math.min(startRow, endRow); i <= Math.max(startRow, endRow); i++) next.add(i);
    setHighlight(next);
  };
  /**
   * 图元悬停（对齐 Java MOUSE_OVER 的两个分支）：
   *   - 普通边/圆点 → `getPartLongFragment` 取所在链，高亮整链；
   *   - 虚线边     → 折叠边高亮其两端（LINEAR_EXPAND_CASE 的 `createSelectedAnswer(delegatedGraph, {up, down})`）；
   *                过滤边不高亮（过滤态无图动作）。
   */
  const hoverEdge = (edge: { up: number; down: number; kind?: 'collapse' | 'filter' } | null): void => {
    if (edge === null) {
      setHighlight(new Set());
      return;
    }
    if (edge.kind === 'collapse') {
      setHighlight(new Set([edge.up, edge.down]));
      return;
    }
    if (edge.kind === 'filter') {
      setHighlight(new Set());
      return;
    }
    hoverChain(edge.up);
  };
  // 已触发过的数据版本（行数）：同一版数据只回调一次，避免「追加页回来 → 副作用重跑 → 再请求」的连环请求；
  // 数据变多后行数变化即视为新版本，若仍未填满视口就继续追加（这正是「一路加载到最早一条」的链）
  const reachedRowsRef = useRef<number | null>(null);
  // 触发条件之二：已加载内容还填不满视口（行高恒为 ROW_HEIGHT，故内容高 = 行数 × ROW_HEIGHT）。
  // 必须有这一条：首次只有 50 条、窗口却很高时，列表根本滚不动，也就永远不会产生滚动事件
  const contentNotFilled = rows.length * ROW_HEIGHT <= height;
  useEffect(() => {
    if (onReachBottom === undefined) return;
    if (!atBottom && !contentNotFilled) return;
    if (reachedRowsRef.current === rows.length) return;
    reachedRowsRef.current = rows.length;
    // 触发后先把「触底」复位：几何要等下一次真实滚动事件才更新，不复位会在内容变高后仍按旧几何重复追加
    setAtBottom(false);
    onReachBottom();
  }, [atBottom, contentNotFilled, rows.length, onReachBottom]);

  return (
    /* ConfigProvider 只包图这一棵子树（见 listyRowHeightTheme）：嵌套 ConfigProvider 与父主题是
       **合并**关系（antd config-provider/hooks/useTheme），算法与明暗 token 全部继承，此处只多一个
       Listy 组件 token */
    <ConfigProvider theme={listyTheme}>
      <Listy
        items={rows}
        rowKey={(row) => row.commit.hash}
        virtual
        height={height}
        // 触底上报（按需加载更早提交的触发源）：holder 是真正的滚动容器，滚动事件带出它的几何；
        // 滚离底部时不清 reachedRowsRef ——「同一版数据只回调一次」的判据是行数，不是滚动位置，
        // 用户来回滚不会重复请求，而数据一旦变多就能继续链式追加
        onScroll={(event) => {
          const holder = event.currentTarget;
          const bottom = holder.scrollHeight - holder.scrollTop - holder.clientHeight <= REACH_BOTTOM_THRESHOLD;
          setAtBottom(bottom);
        }}
        itemRender={(row, index) => {
          const commit = byHash.get(row.commit.hash);
          if (!commit) return null;
          // 选中态：底走主题 token（controlItemBgActive），与提交详情面板当前提交一致
          const selected = selectedHash !== null && row.commit.hash === selectedHash;
          // 本行图列的宽度：**按本行带内实际画出的线**算（`RowGeometry.maxX` 已含本行圆点）——
          // 线条画到更右的车道，本行就补足宽度，否则那条线会被自己的 viewBox 裁掉（旧口径按本行 lane
          // 定宽，实测断线 8px / 66px）。多出来的宽度同时把本行文字往右推：文字起点恒在
          // `车道中心 + DOT_GUTTER`，故「线条最右端」与文字之间始终留着 DOT_GUTTER（见 laneCoveringX）。
          // 没画到右边的行，宽度与旧口径逐像素一致（缩进不变）。
          const geometry = rowGeometry[index] ?? { segments: [], maxX: laneCenterX(row.lane, LANE_WIDTH) };
          const lane = Math.max(row.lane, laneCoveringX(geometry.maxX, LANE_WIDTH));
          const laneAreaWidth = (lane + 1) * LANE_WIDTH + GRAPH_PADDING_X * 2;
          const viewMinX = -GRAPH_PADDING_X;
          // 图列右边界到「本行图列车道中心」的距离恒为 GRAPH_PADDING_X + LANE_WIDTH/2（与 lane 无关）。
          // 用图列的**负右边距**把说明文字拉到「本行图列车道中心 + DOT_GUTTER」：
          // margin 可以往回吃，padding 只能往外推（最小 0，之前几轮就是卡在这，怎么调都差 20 多像素）。
          // 实测口径：本行图列车道 = 本行圆点所在 lane；若本行还画了更右的线（见上），则取那条更右的车道，
          // 文字随之右移 —— 即「文字起点 = 本行最深线条所在车道中心 + DOT_GUTTER」，文字永不压线。
          const laneMarginRight = DOT_GUTTER - (GRAPH_PADDING_X + LANE_WIDTH / 2);
          return (
            <div
              data-testid="commit-graph-row"
              data-selected={selected ? 'true' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: ROW_HEIGHT,
                cursor: onSelect ? 'pointer' : undefined,
                whiteSpace: 'nowrap',
                backgroundColor: selected ? token.controlItemBgActive : undefined,
              }}
              onClick={(event) => {
                // 命中图元时不选中该行（对齐 Java GraphCommitCellController.shouldSelectCell：
                // 光标下有 print element 就返回 false）。用 closest 判 svg 内的 circle/polyline 命中带。
                if ((event.target as Element).closest('circle, polyline[data-testid^="graph-edge-hit-"]') !== null) return;
                onSelect?.(commit.hash);
              }}
              onContextMenu={() => onContextMenu?.(commit.hash)}
            >
              {/*
              图列 = 整图的一个视口：SVG 只有一行高，viewBox 覆盖 x ∈ [−留白, 本行图列右界]，y = 本行那条带。
              只画**落在本行带内的切片与本行圆点**（不是整图重画再裁），线段与圆点都是全局坐标，
              故竖线跨行不断、斜线端点落在竖线上、相邻两行在行边界处共端点。
              视口宽度 = 用户单位宽度，viewBox 与 width 一致 → 1 用户单位 = 1px，无缩放偏移。 */}
              <div
                data-testid="commit-graph-lane"
                style={{ position: 'relative', width: laneAreaWidth, height: ROW_HEIGHT, flexShrink: 0, marginRight: laneMarginRight }}
              >
                <svg
                  width={laneAreaWidth}
                  height={ROW_HEIGHT}
                  viewBox={`${viewMinX} ${index * ROW_HEIGHT} ${laneAreaWidth} ${ROW_HEIGHT}`}
                  style={{ display: 'block', overflow: 'hidden' }}
                >
                  <GraphCanvas
                    segments={geometry.segments}
                    nodes={[{ hash: row.commit.hash, lane: row.lane, rowIndex: index, color: row.color, highlighted: highlight.has(index) }]}
                    rowHeight={ROW_HEIGHT}
                    laneWidth={LANE_WIDTH}
                    highlightColor={token.colorPrimary}
                    onNodeClick={() => {
                      const fragment = linearFragmentAt(rows, index);
                      if (fragment !== null) toggleCollapse(fragment, true);
                    }}
                    onNodeHover={(hash) => (hash === null ? setHighlight(new Set()) : hoverChain(index))}
                    onSegmentClick={(edge) => {
                      // 折叠虚线边 → 展开；过滤虚线边 → 无动作（对齐 Java 过滤态无图动作）；普通实线边 → 折叠其所在链
                      if (edge.kind === 'filter') return;
                      if (edge.kind === 'collapse') {
                        const target = collapsed.find((f) => f.up === rows[edge.up]?.commit.hash && f.down === rows[edge.down]?.commit.hash);
                        if (target !== undefined) toggleCollapse(target, false);
                        return;
                      }
                      const fragment = fragmentForEdge(rows, edge.up, edge.down);
                      if (fragment !== null) toggleCollapse(fragment, true);
                    }}
                    onSegmentHover={hoverEdge}
                  />
                </svg>
              </div>
              {/*
              说明区：**说明文字 + refs chips 作为一个整体**（chips 跟在说明之后）。
              间距口径（用户明确）：
                · 说明文字距**本行图列车道中心** DOT_GUTTER = 8px —— 由上面图列的负右边距落位；
                  只画本行圆点的行，该车道就是圆点所在 lane，与旧口径逐像素一致；
                · chips 距说明文字 8px —— **不写内联 gap**，交给这层 antd Flex 的 `gap="middle"` 档位类名
                  （`.ant-flex-gap-middle`；该档取主题 `padding` token，全站默认紧凑密度下恰为 8px，
                  见 base/page-shell.tsx + base/density.ts）。该等式的锚点见
                  commit-graph.test.tsx「说明区不写内联间距」用例：density token 一动它就红。
              为什么说明区只有这一层（原为「块级 div 套 flex div」两层）：外层本来只承担
              flex:1 + minWidth:0 这两个**收缩契约**，与内层合并后 DOM 少一层，
              收缩/省略行为逐字不变，`style` 里也只剩收缩契约、不含任何间距。
              用 marginLeft（可为负）而不是 paddingLeft（最小为 0）：图列宽度随 lane 变化，
              若用 padding 会把「本行图列宽 − 圆点位置」的差值夹成 0，文字于是比预期远 15~20px——
              那正是之前几轮反复对不上的根因。margin 可以直接落位到「圆点右缘 + 8px」。
              「缩进随线条」由车道的横向位置自然带来（车道越深，线条与文字一起右移）。 */}
              <Flex
                data-testid="commit-graph-message"
                align="center"
                gap="middle"
                style={{ flex: 1, minWidth: 0 }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {commit.message.split('\n')[0]}
                </span>
                {/*
                refs chips 列：宽度按内容自适应（有就占位、没有就不占）；上限 REF_COLUMN_WIDTH。
                本容器只负责**布局契约**（`flexShrink: 1` + `minWidth: 0` 让它能被压缩而不是硬切，
                `overflow: hidden` 兜底），chip 之间与 chips 前后的间距都不在这里写，见 RefChips 与说明区 Flex。 */}
                <span
                  data-testid="commit-graph-refs"
                  style={{
                    flexGrow: 0,
                    flexShrink: 1,
                    minWidth: 0,
                    maxWidth: REF_COLUMN_WIDTH,
                    overflow: 'hidden',
                  }}
                >
                  <RefChips refs={commit.refs} showTags={showTags} />
                </span>
              </Flex>
              <span style={{ width: 144, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.author}</span>
              <Typography.Text
                type="secondary"
                style={{ width: 128, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {formatCommitDate(commit.dateIso)}
              </Typography.Text>
            </div>
          );
        }}
        // 行高须恒为 ROW_HEIGHT（24px，与图的 24px 行距对齐）：Listy 默认行内边距与 1px 下边框都会把行撑高，
        // 故 padding 归零 + 去下边框；逐行差异（选中底色、cursor）留在行元素上。
        styles={{ item: { padding: 0, borderBottom: 'none' } }}
      />
    </ConfigProvider>
  );
}
