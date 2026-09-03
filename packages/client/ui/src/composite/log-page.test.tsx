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

  it('选中提交后右侧渲染 CommitDetailsPanel', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '被选中的提交' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.getByTestId('commit-details')).toBeInTheDocument();
    expect(screen.getByText('被选中的提交')).toBeInTheDocument();
    expect(screen.getByText('c9selec')).toBeInTheDocument();
  });
});
