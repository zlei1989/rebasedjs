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

  it('选中提交后右侧渲染 CommitDetailsPanel', () => {
    const selected = makeCommit({ hash: 'c9selected0001', message: '被选中的提交' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.getByTestId('commit-details')).toBeInTheDocument();
    expect(screen.getByText('被选中的提交')).toBeInTheDocument();
    expect(screen.getByText('c9selec')).toBeInTheDocument();
  });
});
