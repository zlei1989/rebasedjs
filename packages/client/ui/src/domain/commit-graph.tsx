/**
 * 提交图：graph-layout 布局 + 虚拟滚动渲染 + 选中回调。
 * 虚拟滚动走 antd Listy（6.6.0 起的列表组件）：调用方只给提交行数据与行内容，
 * 滚动窗口/行容器由组件负责（行间无分隔线、行内边距归零，见下方 styles.item）。
 * UX 对齐 #2：行默认列为 Subject（图 + refs chips）+ Author + Date（Hash 列省）；
 * 分支 chips 默认开，tag chips 默认关（对齐 Java showTagNames=false），由 showTags 打开。
 */
import { useMemo } from 'react';
import { Listy, Tag, theme } from 'antd';
import type { CommitInfo } from '@rebased/contracts';
import { buildLayout, type LayoutCommit, type LayoutRow } from '../graph-layout';
import { rowCanvasWindow } from './commit-graph-window';
import { colorForRef } from '../graph-layout/color';
import { GraphCanvas } from '../base/graph-canvas';
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

/** 画布切片的空位行（首行的前一行 / 末行的后一行）：无节点无边段，只为占满 3 行画布的高度。
 *  hash 带上位置与行号：空位行在切片里可能出现两次（如只有 1 行数据时前、后都是空位），
 *  复用同一个对象会让 GraphCanvas 内部的 React key 撞车。 */
const emptyRow = (slot: 'prev' | 'next', index: number): LayoutRow => ({
  commit: { hash: `__empty-${slot}-${index}__`, parents: [], refs: [] },
  lane: 0,
  color: 'transparent',
  edges: [],
});

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
        // 画布窗口几何：视口高度/偏移/画布内容平移（口径与不变量见 commit-graph-window.ts 与其单测）
        const win = rowCanvasWindow(index, rows.length, ROW_HEIGHT);
        // 画布恒画 3 行：缺失的邻居（首行的前一行 / 末行的后一行）按空位补，
        // 否则首/末行画布变矮、圆点会跟着偏一行（实测：首行圆点会掉进第二行）
        const slicedRows = [
          index - 1 >= 0 ? rows[index - 1]! : emptyRow('prev', index),
          rows[index]!,
          index + 1 < rows.length ? rows[index + 1]! : emptyRow('next', index),
        ];
        // 画布窗口宽度：取全量布局的最大 lane 数（GraphCanvas 自身的宽度就是这么算的）。
        // 必须显式给宽度：外框是 relative 的定高裁剪盒，若不定宽，其绝对定位的唯一子元素
        // 不参与父盒宽度计算 —— 宽度会塌成 0，整列图直接不可见（实测踩过）。
        const graphWidth = (rows.reduce((m, r) => Math.max(m, r.lane, ...r.edges.map((e) => Math.max(e.fromLane, e.toLane))), 0) + 1) * LANE_WIDTH;
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
              画布窗口（「图与文字行错位」+「分叉线段连接不对」两个问题的修复，几何见 domain/commit-graph-window.ts）：

              ① 错位：GraphCanvas 每行画的是「前一行 + 本行 + 后一行」，而行盒只有 ROW_HEIGHT。
                 改造前每行是绝对定位的定高盒子（隐式裁剪）；换成 Listy 的普通流后行不再裁剪，
                 画布盖到相邻行上 —— 同一列出现 12px 步进的重复圆点，看着就是「图与文字行错位」。

              ② 但不能把行盒裁成 ROW_HEIGHT：相邻行共享一段 12px 高的斜边（分叉/合流），
                 硬裁会把斜边切成两截、各削掉一半，于是「分叉的线段连接不对」。

              做法：行盒不裁剪；每行画布只画「本行 + 前一行」（win.canvasRows），整体上移一行后
              放进一个 3×ROW_HEIGHT 高的 **SVG 视口**（overflow:hidden）——视口覆盖 [上一行顶, 下一行底]，
              与邻居视口首尾相接、互不重叠，于是既不重复画圆点、也不切断斜边；画布内容再按
              win.contentOffsetY 平移，使本行圆点落在视口内第二行中点（= 本行行盒中点）。 */}
            <div style={{ position: 'relative', width: graphWidth, height: ROW_HEIGHT, flexShrink: 0 }}>
              <svg
                width={graphWidth}
                height={win.viewportHeight}
                style={{ position: 'absolute', left: 0, top: win.viewportTop, overflow: 'hidden', display: 'block' }}
              >
                <g transform={`translate(0 ${win.contentOffsetY})`}>
                  <GraphCanvas
                    rows={slicedRows}
                    rowHeight={ROW_HEIGHT}
                    laneWidth={LANE_WIDTH}
                    // 切片起点即行偏移：边段全量行号须平移到切片局部坐标系
                    rowOffset={win.sliceStart}
                  />
                </g>
              </svg>
            </div>
            <span style={{ flex: 1, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <RefChips refs={commit.refs} showTags={showTags} />
              {commit.message.split('\n')[0]}
            </span>
            <span style={{ width: 160, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.author}</span>
            <span style={{ width: 140, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: token.colorTextSecondary }}>{formatCommitDate(commit.dateIso)}</span>
          </div>
        );
      }}
      // 行高须恒为 ROW_HEIGHT（24px，与 GraphCanvas 的定长切片对齐）：Listy 默认行内边距（token
      // itemPaddingBlock/Inline）与 1px 下边框都会把行撑高，故 padding 归零 + 去下边框；
      // 逐行差异（选中底色、cursor）留在行元素上（styles 只支持静态对象/顶层函数）。
      // 残留：antd 包装层把 Listy 的 itemHeight 固定推成 fontHeight + 2×itemPaddingBlock（本主题 ≈36px，
      // 调用方无法传入），而本行实测 24px；因此未渲染过的行按 36px 参与滚动推算，列表刚打开时
      // scrollHeight 偏大（50 条 1536 vs 真值 1200），真实滚轮滚动过程中会被测量-重算迅速收敛
      // （实测底部空带 0px、scrollHeight 收敛到 1200）。若要 24px 精确对齐需经 ConfigProvider 反解
      // antd 内部公式，属内部 API，不采用；回退自研 base/virtual-list 只需还原本文件。
      styles={{ item: { padding: 0, borderBottom: 'none' } }}
    />
  );
}
