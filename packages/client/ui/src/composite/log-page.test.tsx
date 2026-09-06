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

  it('传入 onOpenStashes 时点击贮藏按钮触发回调', () => {
    const onOpenStashes = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenStashes={onOpenStashes} />);
    fireEvent.click(screen.getByRole('button', { name: '贮藏' }));
    expect(onOpenStashes).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenStashes 时不渲染贮藏按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '贮藏' })).not.toBeInTheDocument();
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

  /** 打开顶栏「更多」下拉菜单（Dropdown trigger 为 click，菜单挂到 body） */
  async function openMoreMenu(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    await screen.findByRole('menu');
  }

  it('传入 onOpenPull 时「更多」菜单含拉取项，点击触发回调', async () => {
    const onOpenPull = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={onOpenPull} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('拉取'));
    expect(onOpenPull).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenPush 时「更多」菜单含推送项，点击触发回调', async () => {
    const onOpenPush = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPush={onOpenPush} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('推送'));
    expect(onOpenPush).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenUpdate 时「更多」菜单含更新项目项，点击触发回调', async () => {
    const onOpenUpdate = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenUpdate={onOpenUpdate} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('更新项目'));
    expect(onOpenUpdate).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenRemotes 时「更多」菜单含远程管理项，点击触发回调', async () => {
    const onOpenRemotes = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenRemotes={onOpenRemotes} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('远程管理'));
    expect(onOpenRemotes).toHaveBeenCalledTimes(1);
  });

  it('仅传部分远程入口时「更多」菜单只含对应项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} onOpenRemotes={() => {}} />);
    await openMoreMenu();
    expect(screen.getByText('拉取')).toBeInTheDocument();
    expect(screen.getByText('远程管理')).toBeInTheDocument();
    expect(screen.queryByText('推送')).not.toBeInTheDocument();
    expect(screen.queryByText('更新项目')).not.toBeInTheDocument();
  });

  it('四个远程入口回调均未传时不渲染「更多」按钮', () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} />);
    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
  });

  it('传入 onOpenRebase 时「更多」菜单含变基项，点击触发回调', async () => {
    const onOpenRebase = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenRebase={onOpenRebase} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('变基'));
    expect(onOpenRebase).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenTags 时「更多」菜单含标签项，点击触发回调', async () => {
    const onOpenTags = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenTags={onOpenTags} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('标签'));
    expect(onOpenTags).toHaveBeenCalledTimes(1);
  });

  it('未传 onOpenRebase/onOpenTags 时「更多」菜单不含变基/标签项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('变基')).not.toBeInTheDocument();
    expect(screen.queryByText('标签')).not.toBeInTheDocument();
  });

  it('仅传 onOpenRebase 时「更多」菜单只含变基项（标签与远程项缺省）', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenRebase={() => {}} />);
    await openMoreMenu();
    expect(screen.getByText('变基')).toBeInTheDocument();
    expect(screen.queryByText('标签')).not.toBeInTheDocument();
    expect(screen.queryByText('拉取')).not.toBeInTheDocument();
  });

  it('仅传 onOpenTags 时「更多」菜单只含标签项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenTags={() => {}} />);
    await openMoreMenu();
    expect(screen.getByText('标签')).toBeInTheDocument();
    expect(screen.queryByText('变基')).not.toBeInTheDocument();
    expect(screen.queryByText('推送')).not.toBeInTheDocument();
  });

  it('传入 onOpenBlame 时「更多」菜单含溯源项，点击触发回调', async () => {
    const onOpenBlame = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenBlame={onOpenBlame} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('溯源'));
    expect(onOpenBlame).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenHistory 时「更多」菜单含历史项，点击触发回调', async () => {
    const onOpenHistory = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenHistory={onOpenHistory} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('历史'));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenCommitted 时「更多」菜单含已提交项，点击触发回调', async () => {
    const onOpenCommitted = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenCommitted={onOpenCommitted} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('已提交'));
    expect(onOpenCommitted).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenSearch 时「更多」菜单含搜索项，点击触发回调', async () => {
    const onOpenSearch = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenSearch={onOpenSearch} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('搜索'));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('未传四入口回调时「更多」菜单不含溯源/历史/已提交/搜索项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('溯源')).not.toBeInTheDocument();
    expect(screen.queryByText('历史')).not.toBeInTheDocument();
    expect(screen.queryByText('已提交')).not.toBeInTheDocument();
    expect(screen.queryByText('搜索')).not.toBeInTheDocument();
  });

  it('传入 onOpenPatches 时「更多」菜单含补丁项，点击触发回调', async () => {
    const onOpenPatches = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPatches={onOpenPatches} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('补丁'));
    expect(onOpenPatches).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenShelves 时「更多」菜单含搁置项，点击触发回调', async () => {
    const onOpenShelves = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenShelves={onOpenShelves} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('搁置'));
    expect(onOpenShelves).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenConsole 时「更多」菜单含控制台项，点击触发回调', async () => {
    const onOpenConsole = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenConsole={onOpenConsole} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('控制台'));
    expect(onOpenConsole).toHaveBeenCalledTimes(1);
  });

  it('传入 onOpenIgnore 时「更多」菜单含忽略项，点击触发回调', async () => {
    const onOpenIgnore = vi.fn();
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenIgnore={onOpenIgnore} />);
    await openMoreMenu();
    fireEvent.click(screen.getByText('忽略'));
    expect(onOpenIgnore).toHaveBeenCalledTimes(1);
  });

  it('未传四入口回调时「更多」菜单不含补丁/搁置/控制台/忽略项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('补丁')).not.toBeInTheDocument();
    expect(screen.queryByText('搁置')).not.toBeInTheDocument();
    expect(screen.queryByText('控制台')).not.toBeInTheDocument();
    expect(screen.queryByText('忽略')).not.toBeInTheDocument();
  });

  it('传入 onOpenGithub 且 githubAvailable 时「更多」菜单含 GitHub 面板项，点击触发回调', async () => {
    const onOpenGithub = vi.fn();
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenGithub={onOpenGithub}
        githubAvailable
      />,
    );
    await openMoreMenu();
    fireEvent.click(screen.getByText('GitHub 面板'));
    expect(onOpenGithub).toHaveBeenCalledTimes(1);
  });

  it('githubAvailable=false 时即使传入 onOpenGithub 也不渲染 GitHub 面板项', async () => {
    render(
      <LogPage
        repoName="alpha"
        status={status}
        commits={commits}
        onOpenPull={() => {}}
        onOpenGithub={() => {}}
        githubAvailable={false}
      />,
    );
    await openMoreMenu();
    expect(screen.getByText('拉取')).toBeInTheDocument();
    expect(screen.queryByText('GitHub 面板')).not.toBeInTheDocument();
  });

  it('未传 onOpenGithub/githubAvailable 时「更多」菜单不含 GitHub 面板项', async () => {
    render(<LogPage repoName="alpha" status={status} commits={commits} onOpenPull={() => {}} />);
    await openMoreMenu();
    expect(screen.queryByText('GitHub 面板')).not.toBeInTheDocument();
  });

  it('传入 onCherryPick 时透传给详情面板，点击回调携带选中提交 hash', () => {
    const onCherryPick = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onCherryPick={onCherryPick} />,
    );
    fireEvent.click(screen.getByTestId('cherry-pick'));
    expect(onCherryPick).toHaveBeenCalledWith('c9selected0001');
  });

  it('传入 onRevert 时透传给详情面板，点击回调携带选中提交 hash', () => {
    const onRevert = vi.fn();
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(
      <LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} onRevert={onRevert} />,
    );
    fireEvent.click(screen.getByTestId('revert'));
    expect(onRevert).toHaveBeenCalledWith('c9selected0001');
  });

  it('未传 onCherryPick/onRevert 时详情面板不渲染摘樱桃/还原按钮', () => {
    const selected = makeCommit({ hash: 'c9selected0001' });
    render(<LogPage repoName="alpha" status={status} commits={commits} selectedCommit={selected} />);
    expect(screen.queryByTestId('cherry-pick')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revert')).not.toBeInTheDocument();
  });
});
