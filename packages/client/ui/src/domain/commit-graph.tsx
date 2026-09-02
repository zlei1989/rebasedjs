/**
 * 提交图：graph-layout 布局 + 虚拟滚动渲染 + 选中回调。
 * UX 对齐 #2：行默认列为 Subject（图 + refs chips）+ Author + Date（Hash 列省）；
 * 分支 chips 默认开，tag chips 默认关（对齐 Java showTagNames=false），由 showTags 打开。
 */
import { useMemo } from 'react';
import { Tag } from 'antd';
import type { CommitInfo } from '@rebased/contracts';
import { buildLayout, type LayoutCommit } from '../graph-layout';
import { VirtualList } from '../base/virtual-list';
import { GraphCanvas } from '../base/graph-canvas';
import { classifyRefs } from './refs';
import { formatCommitDate } from './format';

export interface CommitGraphProps {
  commits: CommitInfo[];
  onSelect?: (hash: string) => void;
  height?: number;
  /** tag chips 开关（默认 false，对齐 Java VcsLogApplicationSettings.showTagNames） */
  showTags?: boolean;
}

const ROW_HEIGHT = 24;
const LANE_WIDTH = 18;

/** 单行 refs chips：分支蓝、标签橙 */
function RefChips({ refs, showTags }: { refs: string[]; showTags: boolean }): React.ReactNode {
  const { branches, tags } = classifyRefs(refs);
  return (
    <>
      {branches.map((b) => (
        <Tag key={b} color="blue" style={{ marginInlineEnd: 4 }}>
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

export function CommitGraph({ commits, onSelect, height = 480, showTags = false }: CommitGraphProps): React.ReactNode {
  const layoutCommits: LayoutCommit[] = useMemo(
    () => commits.map((c) => ({ hash: c.hash, parents: c.parents, refs: c.refs })),
    [commits],
  );
  const rows = useMemo(() => buildLayout(layoutCommits), [layoutCommits]);
  // hash → 原始提交（LayoutCommit 只带图字段，行渲染需要 author/date/message）
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c] as const)), [commits]);
  return (
    <VirtualList
      items={rows}
      rowHeight={ROW_HEIGHT}
      height={height}
      renderRow={(row, index) => {
        const commit = byHash.get(row.commit.hash);
        if (!commit) return null;
        return (
          <div
            data-testid="commit-graph-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              height: ROW_HEIGHT,
              cursor: onSelect ? 'pointer' : undefined,
              whiteSpace: 'nowrap',
            }}
            onClick={() => onSelect?.(commit.hash)}
          >
            <GraphCanvas
              rows={rows.slice(Math.max(0, index - 1), index + 2)}
              rowHeight={ROW_HEIGHT}
              laneWidth={LANE_WIDTH}
            />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <RefChips refs={commit.refs} showTags={showTags} />
              {commit.message.split('\n')[0]}
            </span>
            <span style={{ width: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.author}</span>
            <span style={{ width: 140, color: '#888' }}>{formatCommitDate(commit.dateIso)}</span>
          </div>
        );
      }}
    />
  );
}
