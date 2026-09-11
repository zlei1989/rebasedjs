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
 */
import { useMemo } from 'react';
import { Listy, Tag, theme } from 'antd';
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
/** 说明文字与 refs chips 之间的间距（用户口径：8px） */
const CHIP_GAP = 8;
/** refs（分支/标签 chip）列宽上限：单个超长 ref 名在列内横向滚动，不挤掉说明列 */
const REF_COLUMN_WIDTH = 140;

/**
 * 单行 refs chips：分支 chip 底色 = 该分支名的图列色（colorForRef，ref 名 hash → HSB 色板），
 * 与图车道颜色同源——同一分支在图中与 chip 上恒定同色（Java 分支标签着色的等价承载）；
 * 标签 chip 保持橙色预设色（tag 不参与分支着色）。
 */
function RefChips({ refs, showTags }: { refs: string[]; showTags: boolean }): React.ReactNode {
  const { branches, tags } = classifyRefs(refs);
  return (
    <>
      {branches.map((b) => (
        <Tag
          key={b}
          data-testid={`ref-chip-${b}`}
          style={{
            // 不设 marginInlineEnd：与说明文字的间距由外层容器的 gap 统一给（用户口径 8px）
            backgroundColor: colorForRef(b),
            borderColor: 'transparent',
            color: '#fff',
          }}
        >
          {b}
        </Tag>
      ))}
      {showTags
        ? tags.map((t) => (
          <Tag key={t} color="orange">
            {t}
          </Tag>
        ))
        : null}
    </>
  );
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

  return (
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
              说明区：**说明文字 + refs chips 作为一个整体**（chips 跟在说明之后，间距 CHIP_GAP = 8px）。
              间距口径（用户明确）：
                · 说明文字距**本行自己的圆点中心** DOT_GUTTER = 8px；
                · chips 距说明文字 CHIP_GAP = 8px。
              用 marginLeft（可为负）而不是 paddingLeft（最小为 0）：图列宽度随 lane 变化，
              若用 padding 会把「本行图列宽 − 圆点位置」的差值夹成 0，文字于是比预期远 15~20px——
              那正是之前几轮反复对不上的根因。margin 可以直接落位到「圆点右缘 + 8px」。
              「缩进随线条」由 lane 的横向位置自然带来（lane 越深，圆点与文字一起右移）。 */}
            <div
              data-testid="commit-graph-message"
              style={{
                flex: 1,
                minWidth: 0,
                // 图列的负右边距已经把文字拉到「圆点中心 + DOT_GUTTER」，这里无需 padding
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: CHIP_GAP, minWidth: 0 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {commit.message.split('\n')[0]}
                </span>
                {/* refs chips：宽度按内容自适应（有就占位、没有就不占）；上限 REF_COLUMN_WIDTH + 列内滚动 */}
                <span
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
              </div>
            </div>
            <span style={{ width: 160, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.author}</span>
            <span style={{ width: 140, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: token.colorTextSecondary }}>{formatCommitDate(commit.dateIso)}</span>
          </div>
        );
      }}
      // 行高须恒为 ROW_HEIGHT（24px，与图的 24px 行距对齐）：Listy 默认行内边距与 1px 下边框都会把行撑高，
      // 故 padding 归零 + 去下边框；逐行差异（选中底色、cursor）留在行元素上。
      styles={{ item: { padding: 0, borderBottom: 'none' } }}
    />
  );
}
