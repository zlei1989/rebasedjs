/**
 * 提交图：graph-layout 布局 + 虚拟滚动渲染 + 选中回调。
 *
 * 渲染口径（2026-09-12 重构，修「垂直线不闭合 / 斜线接不上主竖线 / 缩进不随线条」）：
 *   - **全图一套全局坐标**：x = laneCenterX(lane)，y = rowCenterY(行号)（见 base/graph-canvas）；
 *   - 线段只编译一次并按行切好（domain/commit-graph-segments，纯函数可单测）：
 *     同一根竖线在相邻两行画出的两半共享同一个端点坐标，行边界处严丝合缝；
 *   - 每行渲染一块 SVG，但它只是整图的一个**视口**（viewBox 取该行那一条 + 左右 padding），
 *     不做任何「按行裁切拼接」，因此不可能出现接缝/重复描边的色差；
 *   - 说明文字的缩进 = 本行预留的 lane 列数 × LANE_WIDTH，**随线条缩进**。
 *
 * UX 对齐 #2：行默认列为 Subject（图 + refs chips）+ Author + Date（Hash 列省）；
 * 分支 chips 默认开，tag chips 默认关（对齐 Java showTagNames=false），由 showTags 打开。
 *
 * 间距口径（2026-09-12）：说明区内的间距**一律不写内联 gap / 自定义 class**，由 antd `Flex` 的档位给
 *   （`gap="middle"` = 主题 `padding` token；全站默认紧凑密度下恰为 8px，见下方说明区注释与测试锚点）。
 */
import { useMemo } from 'react';
import { ConfigProvider, Flex, Listy, Space, Tag, theme } from 'antd';
import type { ThemeConfig } from 'antd';
import type { CommitInfo } from '@rebased/contracts';
import { buildLayout, edgesInRow, type LayoutCommit } from '../graph-layout';
import { colorForRef } from '../graph-layout/color';
import { GraphCanvas } from '../base/graph-canvas';
import { buildRowSegments } from './commit-graph-segments';
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
}

const ROW_HEIGHT = 24;
const LANE_WIDTH = 18;
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
/** refs（分支/标签 chip）列宽上限：单个超长 ref 名在列内横向滚动，不挤掉说明列 */
const REF_COLUMN_WIDTH = 140;

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
 * 与图车道颜色同源——同一分支在图中与 chip 上恒定同色（Java 分支标签着色的等价承载）；
 * 标签 chip 保持橙色预设色（tag 不参与分支着色）。
 *
 * 多个 chip 之间的间距（用户口径 4px，视觉上更紧凑）：由 antd `Space` 的 `size="small"` 档位类名统一给
 * （`.ant-space-gap-col-small` = 主题 `paddingXS` token，紧凑密度下 4px；
 * 与说明区 Flex 的 `gap="middle"`（= `padding` = 8px）是两个独立档位，互不影响）。
 * 注意两点，否则「间距会静默消失」：
 *   1. `Space` 只对**直接子项**加间距 —— 必须把 chips 摊平成数组直接交给它，
 *      不能用一个 Fragment 把全部 chip 包成一坨（那样 Space 只看到 1 个子项，chip 之间一个像素都没有）；
 *   2. 不写内联 `gap` / 不给 `Tag` 加 margin（antd v6 的 Tag 本就无默认 margin，实测 0，
 *      故 Space 的档位间距不会被叠加成两份）。
 * 无 refs 时返回 null（不留空壳 DOM）。
 */
function RefChips({ refs, showTags }: { refs: string[]; showTags: boolean }): React.ReactNode {
  const { branches, tags } = classifyRefs(refs);
  // 摊平成一个数组：分支 chips 在前、标签 chips 在后（顺序与 classifyRefs 的分类一致）。
  // key 加前缀：两类 chip 现在同处一个 children 数组，避免「分支名与标签名同名」时 key 撞车。
  const chips = [
    ...branches.map((b) => (
      <Tag
        key={`branch:${b}`}
        data-testid={`ref-chip-${b}`}
        style={{
          // 不设 marginInlineEnd：与说明文字的间距由说明区 Flex 的 gap 统一给（用户口径 8px）
          backgroundColor: colorForRef(b),
          borderColor: 'transparent',
          color: '#fff',
        }}
      >
        {b}
      </Tag>
    )),
    ...(showTags
      ? tags.map((t) => (
        <Tag key={`tag:${t}`} color="orange">
          {t}
        </Tag>
      ))
      : []),
  ];
  if (chips.length === 0) return null;
  return <Space size="small">{chips}</Space>;
}

export function CommitGraph({
  commits,
  onSelect,
  onContextMenu,
  height = 480,
  showTags = false,
  selectedHash = null,
}: CommitGraphProps): React.ReactNode {
  // 日期列用主题次要文本色（原 #888 是暗色专用硬编码，明亮主题下对比不足）
  const { token } = theme.useToken();
  const layoutCommits: LayoutCommit[] = useMemo(
    () => commits.map((c) => ({ hash: c.hash, parents: c.parents, refs: c.refs })),
    [commits],
  );
  const rows = useMemo(() => buildLayout(layoutCommits), [layoutCommits]);
  // 跨行长边（edgesInRow）：既用于编译线段，也用于把「经过本行的长边」计入该行的缩进
  const rowEdges = useMemo(() => edgesInRow(rows), [rows]);
  const segmentsPerRow = useMemo(
    () => buildRowSegments(rows, rowEdges, ROW_HEIGHT, LANE_WIDTH),
    [rows, rowEdges],
  );
  // hash → 原始提交（LayoutCommit 只带图字段，行渲染需要 author/date/message）
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c] as const)), [commits]);
  // antd 的 fontHeight 是运行时 token（genFontMapToken 生成），6.6.3 的类型里没有声明它，
  // 而 Listy 内部算 itemHeight 读的正是同一个值，故这里按运行时口径窄化读取（缺失时按紧凑密度实测值 20）。
  const fontHeight = (token as { fontHeight?: number }).fontHeight ?? 20;
  const listyTheme = useMemo(() => listyRowHeightTheme(fontHeight), [fontHeight]);

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
        itemRender={(row, index) => {
          const commit = byHash.get(row.commit.hash);
          if (!commit) return null;
          // 选中态：底走主题 token（controlItemBgActive），与提交详情面板当前提交一致
          const selected = selectedHash !== null && row.commit.hash === selectedHash;
          // 本行图列的宽度：按**本行圆点所在 lane** 算（lane 0 的行只占 1 条 lane），
          // 不用全图最宽、也不用「经过本行的长边」——后者只是从文字下方穿过，不该把本行文字推远。
          // 画到更右 lane 的边会被视口裁掉（切线朝下/朝上走，视觉上仍连续）。
          const laneAreaWidth = (row.lane + 1) * LANE_WIDTH + GRAPH_PADDING_X * 2;
          const viewMinX = -GRAPH_PADDING_X;
          // 图列右边界到「本行圆点中心」的距离恒为 GRAPH_PADDING_X + LANE_WIDTH/2（与 lane 无关）。
          // 用图列的**负右边距**把说明文字拉到「圆点中心 + DOT_GUTTER」：
          // margin 可以往回吃，padding 只能往外推（最小 0，之前几轮就是卡在这，怎么调都差 20 多像素）。
          // 实测口径：文字距圆点中心 = DOT_GUTTER，所有 lane、所有仓库都是同一个值。
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
              onClick={() => onSelect?.(commit.hash)}
              onContextMenu={() => onContextMenu?.(commit.hash)}
            >
              {/*
              图列 = 整图的一个视口：SVG 只有一行高，viewBox 覆盖 x ∈ [−留白, 本行最大 lane]，y = 本行那条带。
              线段与圆点都由 GraphCanvas 按全局坐标画，故竖线跨行不断、斜线端点落在竖线上。
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
                    segmentsPerRow={segmentsPerRow}
                    rows={rows}
                    rowHeight={ROW_HEIGHT}
                    laneWidth={LANE_WIDTH}
                  />
                </svg>
              </div>
              {/*
              说明区：**说明文字 + refs chips 作为一个整体**（chips 跟在说明之后）。
              间距口径（用户明确）：
                · 说明文字距**本行自己的圆点中心** DOT_GUTTER = 8px —— 由上面图列的负右边距落位；
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
              「缩进随线条」由 lane 的横向位置自然带来（lane 越深，圆点与文字一起右移）。 */}
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
                refs chips 列：宽度按内容自适应（有就占位、没有就不占）；上限 REF_COLUMN_WIDTH + 列内滚动。
                本容器只负责**布局契约**（收缩行为 + 上限 + 列内横向滚动），
                chip 之间与 chips 前后的间距都不在这里写，见 RefChips 与说明区 Flex。 */}
                <span
                  data-testid="commit-graph-refs"
                  style={{
                    flexGrow: 0,
                    flexShrink: 0,
                    maxWidth: REF_COLUMN_WIDTH,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    scrollbarWidth: 'none',
                  }}
                >
                  <RefChips refs={commit.refs} showTags={showTags} />
                </span>
              </Flex>
              <span style={{ width: 160, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.author}</span>
              <span style={{ width: 140, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: token.colorTextSecondary }}>{formatCommitDate(commit.dateIso)}</span>
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
