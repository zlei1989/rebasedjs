/**
 * 日志页：顶栏（仓库名 + RepoStatusBar）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit 由调用方容器注入（hooks 数据在 Task 6/9 装配）。
 */
import type { CommitInfo, RepoStatus } from '@rebased/contracts';
import { RepoStatusBar } from '../domain/repo-status-bar';
import { CommitGraph } from '../domain/commit-graph';
import { CommitDetailsPanel } from '../domain/commit-details-panel';

export interface LogPageProps {
  repoName: string;
  status: RepoStatus;
  commits: CommitInfo[];
  onSelectCommit?: (hash: string) => void;
  /** 当前选中提交；null/缺省不渲染详情面板 */
  selectedCommit?: CommitInfo | null;
}

export function LogPage({ repoName, status, commits, onSelectCommit, selectedCommit }: LogPageProps): React.ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #f0f0f0' }}>
        <span style={{ fontWeight: 600, padding: '4px 8px' }}>{repoName}</span>
        <RepoStatusBar status={status} />
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <CommitGraph commits={commits} onSelect={onSelectCommit} />
        </div>
        {selectedCommit ? (
          <div
            data-testid="commit-details"
            style={{ width: 320, flexShrink: 0, borderLeft: '1px solid #f0f0f0', overflow: 'auto' }}
          >
            <CommitDetailsPanel commit={selectedCommit} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
