import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo, RepoStatus } from '@rebased/contracts';
import { LogPage } from './log-page';

/** 测试提交工厂：补全 CommitInfo 必填字段，按需覆盖 */
function makeCommit(overrides: Partial<CommitInfo> & { hash: string }): CommitInfo {
  return {
    shortHash: overrides.hash.slice(0, 7),
    parents: [],
    author: 'Alice',
    authorEmail: 'alice@example.com',
    dateIso: '2026-09-01T14:30:00+08:00',
    refs: [],
    message: '提交说明',
    graph: '',
    ...overrides,
  };
}

const status: RepoStatus = { branch: 'main', upstream: 'origin/main', headHash: 'a'.repeat(40), ahead: 0, behind: 0, entries: [] };

const commits: CommitInfo[] = [
  makeCommit({ hash: 'c2', parents: ['c1'], message: '第二笔提交' }),
  makeCommit({ hash: 'c1', parents: [], message: '初始提交' }),
];

describe('LogPage', () => {
  it('渲染仓库名、RepoStatusBar 与 CommitGraph 行', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getAllByTestId('commit-graph-row')).toHaveLength(2);
  });

  it('点击提交行触发 onSelectCommit(hash)', () => {
    const onSelectCommit = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onSelectCommit={onSelectCommit} />);
    fireEvent.click(screen.getByText('初始提交'));
    expect(onSelectCommit).toHaveBeenCalledWith('c1');
  });

  it('未选中提交时不渲染详情面板', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={null} />);
    expect(screen.queryByTestId('commit-details')).not.toBeInTheDocument();
  });

  it('传入 operation 与 onAbortOperation 时顶栏渲染进行中操作条', () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        operation={{ kind: 'merge' }}
        onAbortOperation={() => {}}
      />,
    );
    expect(screen.getByText('合并中')).toBeInTheDocument();
  });

  it('缺 onAbortOperation 时不渲染操作条', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} operation={{ kind: 'merge' }} />);
    expect(screen.queryByText('合并中')).not.toBeInTheDocument();
  });

  it('传入 onOpenSettings 时点击设置按钮触发回调', () => {
    const onOpenSettings = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenSettings 时不渲染设置按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
  });

  it('传入 onOpenStatus 时点击变更按钮触发回调', () => {
    const onOpenStatus = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenStatus={onOpenStatus} />);
    fireEvent.click(screen.getByRole('button', { name: '变更' }));
    expect(onOpenStatus).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenStatus 时不渲染变更按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '变更' })).not.toBeInTheDocument();
  });

  it('传入 onOpenBranches 时点击分支按钮触发回调', () => {
    const onOpenBranches = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenBranches={onOpenBranches} />);
    fireEvent.click(screen.getByRole('button', { name: '分支' }));
    expect(onOpenBranches).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenBranches 时不渲染分支按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '分支' })).not.toBeInTheDocument();
  });

  it('选中提交后右侧渲染 CommitDetailsPanel', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '被选中的提交' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.getByTestId('commit-details')).toBeInTheDocument();
    expect(screen.getByText('被选中的提交')).toBeInTheDocument();
    expect(screen.getByText('c9selec')).toBeInTheDocument();
  });

  it('传入 onUndoCommit 时渲染撤销最近提交按钮，Popconfirm 确认后回调', async () => {
    const onUndoCommit = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onUndoCommit={onUndoCommit} />);
    fireEvent.click(screen.getByRole('button', { name: '撤销最近提交' }));
    expect(await screen.findByText('将撤销最近提交并保留改动到暂存区')).toBeInTheDocument();
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onUndoCommit).toHaveBeenCalledTimes(1);
  });

  it('未传 onUndoCommit 时不渲染撤销按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '撤销最近提交' })).not.toBeInTheDocument();
  });

  it('undoCommitting 时撤销按钮进入 loading 态', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onUndoCommit={() => {}} undoCommitting />);
    expect(screen.getByRole('button', { name: '撤销最近提交' })).toHaveClass('ant-btn-loading');
  });

  it('传入 onResetHere 时透传给详情面板，点击回调带选中提交 hash', () => {
    const onResetHere = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onResetHere={onResetHere} />,
    );
    fireEvent.click(screen.getByTestId('reset-here'));
    expect(onResetHere).toHaveBeenCalledWith('c9selected0001');
  });

  it('未传 onResetHere 时详情面板不渲染 Reset 按钮', () => {
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.queryByTestId('reset-here')).not.toBeInTheDocument();
  });

  it('传入 onOpenMerge 时点击合并按钮触发回调', () => {
    const onOpenMerge = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenMerge={onOpenMerge} />);
    fireEvent.click(screen.getByRole('button', { name: '合并' }));
    expect(onOpenMerge).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenMerge 时不渲染合并按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '合并' })).not.toBeInTheDocument();
  });

  it('operation.kind 为 merge 且传入 onOpenConflicts 时渲染「去解决冲突」，点击触发回调', () => {
    const onOpenConflicts = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        operation={{ kind: 'merge' }}
        onOpenConflicts={onOpenConflicts}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '去解决冲突' }));
    expect(onOpenConflicts).toHaveBeenCalledTimes(1);
  });

  it('operation.kind 非 merge 时即使传入 onOpenConflicts 也不渲染「去解决冲突」', () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        operation={{ kind: 'cherry-pick' }}
        onOpenConflicts={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: '去解决冲突' })).not.toBeInTheDocument();
  });

  it('未传 onOpenConflicts 时不渲染「去解决冲突」', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} operation={{ kind: 'merge' }} />);
    expect(screen.queryByRole('button', { name: '去解决冲突' })).not.toBeInTheDocument();
  });
});
