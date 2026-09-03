/**
 * 日志页：顶栏（仓库名 + RepoStatusBar + OperationStatus + 变更/分支/设置入口）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit/operation 由调用方容器注入（hooks 数据在应用层装配）。
 */
import { BranchesOutlined, DiffOutlined, RollbackOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Popconfirm } from 'antd';
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
  /** 变更（状态页）入口回调；缺省不渲染变更按钮 */
  onOpenStatus?: () => void;
  /** 分支页入口回调；缺省不渲染分支按钮 */
  onOpenBranches?: () => void;
  /** 撤销最近提交回调（Popconfirm 确认后触发）；缺省不渲染撤销按钮 */
  onUndoCommit?: () => void;
  /** 撤销请求进行中：撤销按钮 loading 态 */
  undoCommitting?: boolean;
  /** 透传给 CommitDetailsPanel 的「Reset 当前分支到此处」回调；缺省详情面板不渲染该按钮 */
  onResetHere?: (hash: string) => void;
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
  onOpenStatus,
  onOpenBranches,
  onUndoCommit,
  undoCommitting,
  onResetHere,
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
        {/* 撤销最近提交：Popconfirm 确认后回调（保留改动到暂存区，等价 reset --soft HEAD~1） */}
        {onUndoCommit ? (
          <Popconfirm
            title="将撤销最近提交并保留改动到暂存区"
            okText="确定"
            cancelText="取消"
            onConfirm={onUndoCommit}
          >
            <Button
              aria-label="撤销最近提交"
              type="text"
              icon={<RollbackOutlined />}
              loading={undoCommitting}
            />
          </Popconfirm>
        ) : null}
        {/* 变更入口（状态页）：在设置按钮旁、靠右对齐；仅在容器注入导航回调时渲染 */}
        {onOpenStatus ? (
          <Button
            aria-label="变更"
            type="text"
            icon={<DiffOutlined />}
            onClick={onOpenStatus}
            style={{ marginLeft: 'auto' }}
          />
        ) : null}
        {/* 分支入口：排在变更与设置之间；变更按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenBranches ? (
          <Button
            aria-label="分支"
            type="text"
            icon={<BranchesOutlined />}
            onClick={onOpenBranches}
            style={onOpenStatus ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 设置入口靠右对齐；变更/分支按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenSettings ? (
          <Button
            aria-label="设置"
            type="text"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
            style={onOpenStatus || onOpenBranches ? undefined : { marginLeft: 'auto' }}
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
            <CommitDetailsPanel commit={selectedCommit} onResetHere={onResetHere} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
