/**
 * 日志页：顶栏（仓库名 + RepoStatusBar + OperationStatus + 变更/分支/合并/贮藏/设置入口 + 「更多」下拉）+ CommitGraph + 右侧 CommitDetailsPanel。
 * 纯 props 驱动：status/commits/selectedCommit/operation 由调用方容器注入（hooks 数据在应用层装配）。
 * 合并中（operation.kind==='merge'）时顶栏在操作条旁追加「去解决冲突」链接（onOpenConflicts 注入才渲染）。
 * 顶栏收敛：五个页面导航按钮保留为主按钮区；远程相关操作（拉取/推送/更新项目/远程管理）收进「更多」Dropdown，
 * 仅在容器注入对应回调时出现对应菜单项，四个回调全缺省时不渲染「更多」按钮。
 */
import { BranchesOutlined, DiffOutlined, InboxOutlined, MergeOutlined, MoreOutlined, RollbackOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Dropdown, Popconfirm } from 'antd';
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
  /** 合并页入口回调；缺省不渲染合并按钮 */
  onOpenMerge?: () => void;
  /** 贮藏页入口回调；缺省不渲染贮藏按钮 */
  onOpenStashes?: () => void;
  /** 拉取对话框入口回调；缺省时「更多」菜单不含拉取项 */
  onOpenPull?: () => void;
  /** 推送对话框入口回调；缺省时「更多」菜单不含推送项 */
  onOpenPush?: () => void;
  /** 更新项目对话框入口回调；缺省时「更多」菜单不含更新项目项 */
  onOpenUpdate?: () => void;
  /** 远程管理页入口回调；缺省时「更多」菜单不含远程管理项 */
  onOpenRemotes?: () => void;
  /** 冲突页入口回调；仅当 operation.kind==='merge' 时渲染「去解决冲突」链接，缺省不渲染 */
  onOpenConflicts?: () => void;
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
  onOpenMerge,
  onOpenStashes,
  onOpenPull,
  onOpenPush,
  onOpenUpdate,
  onOpenRemotes,
  onOpenConflicts,
  onUndoCommit,
  undoCommitting,
  onResetHere,
}: LogPageProps): React.ReactNode {
  // 「更多」菜单项：仅装配容器注入回调的远程操作入口；全缺省时连「更多」按钮都不渲染
  const moreItems = [
    ...(onOpenPull ? [{ key: 'pull', label: '拉取' }] : []),
    ...(onOpenPush ? [{ key: 'push', label: '推送' }] : []),
    ...(onOpenUpdate ? [{ key: 'update', label: '更新项目' }] : []),
    ...(onOpenRemotes ? [{ key: 'remotes', label: '远程管理' }] : []),
  ];
  /** 「更多」菜单点击分发：按 key 调对应入口回调 */
  const onMoreClick = (key: string): void => {
    if (key === 'pull') onOpenPull?.();
    else if (key === 'push') onOpenPush?.();
    else if (key === 'update') onOpenUpdate?.();
    else if (key === 'remotes') onOpenRemotes?.();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #f0f0f0' }}>
        <span style={{ fontWeight: 600, padding: '4px 8px' }}>{repoName}</span>
        <RepoStatusBar status={status} />
        {/* 进行中操作条：仅当容器同时注入 operation 与中止回调时渲染 */}
        {operation && onAbortOperation ? (
          <OperationStatus operation={operation} onAbort={onAbortOperation} aborting={abortingOperation} />
        ) : null}
        {/* 「去解决冲突」链接：仅合并进行中（operation.kind==='merge'）且容器注入导航回调时渲染，
            跟在操作条旁；base 组件 OperationStatus 不背导航职责，故由本层自行渲染 */}
        {operation?.kind === 'merge' && onOpenConflicts ? (
          <Button type="link" size="small" onClick={onOpenConflicts}>
            去解决冲突
          </Button>
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
        {/* 合并入口：排在分支与设置之间；前面按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenMerge ? (
          <Button
            aria-label="合并"
            type="text"
            icon={<MergeOutlined />}
            onClick={onOpenMerge}
            style={onOpenStatus || onOpenBranches ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 贮藏入口：排在合并与设置之间；前面按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenStashes ? (
          <Button
            aria-label="贮藏"
            type="text"
            icon={<InboxOutlined />}
            onClick={onOpenStashes}
            style={onOpenStatus || onOpenBranches || onOpenMerge ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 设置入口靠右对齐；变更/分支/合并/贮藏按钮已占位（marginLeft:auto）时不再重复右推 */}
        {onOpenSettings ? (
          <Button
            aria-label="设置"
            type="text"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
            style={onOpenStatus || onOpenBranches || onOpenMerge || onOpenStashes ? undefined : { marginLeft: 'auto' }}
          />
        ) : null}
        {/* 「更多」Dropdown：远程相关操作（拉取/推送/更新项目/远程管理）的收敛入口，跟在设置按钮之后；
            前面按钮已占位（marginLeft:auto）时不再重复右推 */}
        {moreItems.length > 0 ? (
          <Dropdown trigger={['click']} menu={{ items: moreItems, onClick: ({ key }) => onMoreClick(key) }}>
            <Button
              aria-label="更多"
              type="text"
              icon={<MoreOutlined />}
              style={
                onOpenStatus || onOpenBranches || onOpenMerge || onOpenStashes || onOpenSettings
                  ? undefined
                  : { marginLeft: 'auto' }
              }
            />
          </Dropdown>
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
