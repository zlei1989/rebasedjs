/**
 * 日志页：顶栏（仓库名 + RepoStatusBar + OperationStatus + 设置入口）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit/operation 由调用方容器注入（hooks 数据在应用层装配）。
 */
import { SettingOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { CommitInfo, OperationState, RepoStatus } from '@rebased/contracts';
import { OperationStatus } from '../base/operation-status';
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
  /** 进行中操作状态；与 onAbortOperation 同传时顶栏渲染操作条 */
  operation?: OperationState;
  /** 中止当前操作回调（经 OperationStatus 的 Popconfirm 确认后触发） */
  onAbortOperation?: () => void;
  /** 中止请求进行中：操作条按钮 loading 态 */
  abortingOperation?: boolean;
  /** 设置入口回调；缺省不渲染设置按钮 */
  onOpenSettings?: () => void;
}

export function LogPage({
  repoName,
  status,
  commits,
  onSelectCommit,
  selectedCommit,
  operation,
  onAbortOperation,
  abortingOperation,
  onOpenSettings,
}: LogPageProps): React.ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #f0f0f0' }}>
        <span style={{ fontWeight: 600, padding: '4px 8px' }}>{repoName}</span>
        <RepoStatusBar status={status} />
        {/* 进行中操作条：仅当容器同时注入 operation 与中止回调时渲染 */}
        {operation && onAbortOperation ? (
          <OperationStatus operation={operation} onAbort={onAbortOperation} aborting={abortingOperation} />
        ) : null}
        {/* 设置入口靠右对齐；仅在容器注入导航回调时渲染 */}
        {onOpenSettings ? (
          <Button
            aria-label="设置"
            type="text"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
            style={{ marginLeft: 'auto' }}
          />
        ) : null}
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
