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
/** 图列左右留白：不留会让 lane 0 的圆点被视口边缘切掉 */
const GRAPH_PADDING_X = 10;
/** refs（分支/标签 chip）列宽：所有行的说明从同一列之后起排 */
const REF_COLUMN_WIDTH = 140;
const REF_COLUMN_MIN_WIDTH = 96;

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
            marginInlineEnd: 4,
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
          <Tag key={t} color="orange" style={{ marginInlineEnd: 4 }}>
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
  // 全图 lane 数：所有行共用同一宽度，保证各行竖线的 x 完全一致
  const laneCount = useMemo(() => {
    let maxLane = 0;
    rows.forEach((row, i) => {
      maxLane = Math.max(maxLane, row.lane, ...row.edges.map((e) => Math.max(e.fromLane, e.toLane)));
      rowEdges[i].forEach((e) => {
        maxLane = Math.max(maxLane, e.fromLane, e.toLane);
      });
    });
    return rows.length === 0 ? 1 : maxLane + 1;
  }, [rows, rowEdges]);
  // hash → 原始提交（LayoutCommit 只带图字段，行渲染需要 author/date/message）
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c] as const)), [commits]);
  const graphWidth = laneCount * LANE_WIDTH;
  const viewportWidth = graphWidth + GRAPH_PADDING_X * 2;

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
        // 本行预留的 lane 列数（本行节点 + 经过本行的长边）→ 说明文字的缩进，随线条走
        const maxLane = rowEdges[index]?.reduce((m, e) => Math.max(m, e.fromLane, e.toLane), row.lane) ?? row.lane;
        const indent = (maxLane + 1) * LANE_WIDTH;
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
              图列 = 整图的一个视口：SVG 自身只有一行高，viewBox 取全局坐标
              y ∈ [本行顶, 本行底]、x ∈ [−padding, 图宽 + padding]。
              线段与圆点都由 GraphCanvas 按全局坐标画，故：竖线跨行不断、斜线端点落在竖线上。 */}
            <div
              data-testid="commit-graph-lane"
              style={{ position: 'relative', width: viewportWidth, height: ROW_HEIGHT, flexShrink: 0 }}
            >
              <svg
                width={viewportWidth}
                height={ROW_HEIGHT}
                viewBox={`${-GRAPH_PADDING_X} ${index * ROW_HEIGHT} ${viewportWidth} ${ROW_HEIGHT}`}
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
              refs 列：宽度**按本行的 ref 内容自适应**（有 chip 就占位、没有就不占位）。
              为什么不给固定宽度：绝大多数行没有分支/标签，固定宽度会让这些行白白空出一整列
              （实测 140px），说明文字被顶到很右边、与左侧线条的联系被切断 —— 这就是「缩进还有点问题」的观感来源。
              上限 REF_COLUMN_WIDTH + 溢出滚动：单个超长 ref 名不会把说明列挤没。
              说明文字自己的缩进（paddingLeft = lane 列数 × LANE_WIDTH）另行叠加，保持「随线条缩进」。 */}
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
            <span
              style={{
                flex: 1,
                minWidth: 80,
                // 说明缩进 = 本行预留的 lane 列数 × lane 宽（随线条缩进）
                paddingLeft: indent,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {commit.message.split('\n')[0]}
            </span>
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
