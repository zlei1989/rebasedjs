/**
 * RepoTopNav（仓库顶栏导航）单测：三级面包屑（页名/仓库名链接）/分支 chip/高亮映射/日志按钮/更多菜单装配。
 * 高亮断言走 antd 类名：激活态渲染 color=primary + variant=filled，按钮带 `ant-btn-color-primary`
 * 与 `ant-btn-variant-filled` 类；非激活态是 type=text（`ant-btn-variant-text`）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RepoStatus } from '@rebased/contracts';
import { RepoTopNav } from './repo-top-nav';

/** 最小可渲染 RepoStatus 夹具（RepoStatusBar 只读展示，字段值不影响本套断言） */
const status: RepoStatus = {
  branch: 'main',
  upstream: null,
  headHash: 'c1',
  ahead: 0,
  behind: 0,
  entries: [],
};

/** 打开「更多」下拉（trigger 为 click，菜单挂在 body）：返回「更多」按钮 */
const openMore = (): HTMLElement => {
  const more = screen.getByRole('button', { name: '更多' });
  fireEvent.click(more);
  return more;
};

describe('RepoTopNav', () => {
  it('面包屑「首页 / 仓库名」：传 onGoHome 时「首页」可点并回调', () => {
    const onGoHome = vi.fn();
    render(<RepoTopNav repoName="alpha" onGoHome={onGoHome} />);
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('首页');
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('alpha');
    fireEvent.click(screen.getByTestId('log-go-home'));
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('未传 onGoHome 时面包屑只剩仓库名一项（不渲染死链接）', () => {
    render(<RepoTopNav repoName="alpha" />);
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('alpha');
    expect(screen.queryByTestId('log-go-home')).not.toBeInTheDocument();
  });

  it('「日志」按钮：传 onOpenLog 时渲染并回调；未传不渲染', () => {
    const onOpenLog = vi.fn();
    const { rerender } = render(<RepoTopNav repoName="alpha" onOpenLog={onOpenLog} />);
    fireEvent.click(screen.getByRole('button', { name: '日志' }));
    expect(onOpenLog).toHaveBeenCalledTimes(1);
    rerender(<RepoTopNav repoName="alpha" />);
    expect(screen.queryByRole('button', { name: '日志' })).not.toBeInTheDocument();
  });

  it('current 命中主按钮区：对应图标按钮呈 primary filled 高亮，其余保持 text', () => {
    render(<RepoTopNav repoName="alpha" current="status" onOpenStatus={() => {}} onOpenBranches={() => {}} />);
    const status = screen.getByRole('button', { name: '变更' });
    expect(status).toHaveClass('ant-btn-color-primary');
    expect(status).toHaveClass('ant-btn-variant-filled');
    const branches = screen.getByRole('button', { name: '分支' });
    expect(branches).not.toHaveClass('ant-btn-color-primary');
    expect(branches).toHaveClass('ant-btn-variant-text');
  });

  it('current 为 log：日志按钮高亮', () => {
    render(<RepoTopNav repoName="alpha" current="log" onOpenLog={() => {}} />);
    const log = screen.getByRole('button', { name: '日志' });
    expect(log).toHaveClass('ant-btn-color-primary');
    expect(log).toHaveClass('ant-btn-variant-filled');
  });

  it('current 落在「更多」菜单页（如 tags）：「更多」按钮高亮，主按钮区不高亮', () => {
    render(<RepoTopNav repoName="alpha" current="tags" onOpenTags={() => {}} onOpenStatus={() => {}} />);
    const more = openMore();
    expect(more).toHaveClass('ant-btn-color-primary');
    expect(more).toHaveClass('ant-btn-variant-filled');
    expect(screen.getByRole('button', { name: '变更' })).toHaveClass('ant-btn-variant-text');
  });

  it('current 为 conflicts/diff（不在导航任何位置）：所有按钮均不高亮', () => {
    const { rerender } = render(<RepoTopNav repoName="alpha" current="conflicts" onOpenStatus={() => {}} />);
    expect(screen.getByRole('button', { name: '变更' })).toHaveClass('ant-btn-variant-text');
    rerender(<RepoTopNav repoName="alpha" current="diff" onOpenStatus={() => {}} />);
    expect(screen.getByRole('button', { name: '变更' })).toHaveClass('ant-btn-variant-text');
  });

  it('current 传入时面包屑三级：页名为加粗末级，非日志页仓库名可点回日志页', () => {
    const onOpenLog = vi.fn();
    render(<RepoTopNav repoName="alpha" current="status" onOpenLog={onOpenLog} />);
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('alpha');
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('变更');
    fireEvent.click(screen.getByTestId('log-repo-link'));
    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  it('current="log" 时页名为「提交」，仓库名不可点（日志页自己是末级）', () => {
    render(<RepoTopNav repoName="alpha" current="log" onOpenLog={() => {}} />);
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('提交');
    expect(screen.queryByTestId('log-repo-link')).not.toBeInTheDocument();
  });

  it('current 缺省时面包屑保持两级（仓库名加粗为末级，向后兼容兜底形态）', () => {
    render(<RepoTopNav repoName="alpha" />);
    expect(screen.getByTestId('log-breadcrumb')).toHaveTextContent('alpha');
    // 无 current 就没有页名一级
    expect(screen.queryByText('提交')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-repo-link')).not.toBeInTheDocument();
  });

  it('status 注入时任意仓库页渲染分支 chip（不再限日志页）', () => {
    render(<RepoTopNav repoName="alpha" current="status" status={status} />);
    expect(screen.getByTestId('status-branch-chip')).toHaveTextContent('main');
  });

  // 布局（用户口径）：分支状态条整条移到右侧操作区最左——与操作按钮同组，chip 落在该组第一个位置
  it('分支状态条挂在右侧操作区最左（chip 是操作组的第一个子项，不再在面包屑旁）', () => {
    render(<RepoTopNav repoName="alpha" status={status} onUndoCommit={() => {}} />);
    const actions = screen.getByTestId('log-actions');
    const chip = screen.getByTestId('status-branch-chip');
    expect(actions).toContainElement(chip);
    // 结构顺序即左右：状态条是操作组的第一项，后面才是撤销等按钮
    expect(actions.firstElementChild).toContainElement(chip);
    expect(screen.getByTestId('log-breadcrumb')).not.toContainElement(chip);
  });

  // 状态条搬走后左侧那个 Space 只装「进行中操作条 + 去解决冲突」：只注入 status 时不得留下空容器
  it('只注入 status 时左侧信息区不渲染多余容器（面包屑的兄弟节点为空）', () => {
    render(<RepoTopNav repoName="alpha" status={status} />);
    const breadcrumb = screen.getByTestId('log-breadcrumb');
    expect(breadcrumb.parentElement?.querySelector('.ant-space')).toBeNull();
  });

  // 回归（浏览器实测发现）：无进行中操作时容器传下来的是 `{kind:'none'}` 而非 undefined，
  // 而 OperationStatus 自己把这个 kind 渲染成 null——只按 `!== undefined` 判空会留下一个空 Space
  it('operation 为 none（无进行中操作）时左侧不留空容器', () => {
    render(<RepoTopNav repoName="alpha" status={status} operation={{ kind: 'none' }} onAbortOperation={() => {}} />);
    expect(screen.getByTestId('log-breadcrumb').parentElement?.querySelector('.ant-space')).toBeNull();
  });

  it('日志页专属内容按注入渲染：status 驱动状态条；onUndoCommit 驱动撤销按钮（Popconfirm 确认后回调）', async () => {
    const onUndoCommit = vi.fn();
    render(<RepoTopNav repoName="alpha" status={status} onUndoCommit={onUndoCommit} />);
    // RepoStatusBar 至少呈现分支名
    expect(screen.getByText('main')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销最近提交' }));
    expect(await screen.findByText('将撤销最近提交并保留改动到暂存区')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onUndoCommit).toHaveBeenCalledTimes(1);
  });

  it('未注入 status/操作条时不渲染状态条与撤销按钮（精简导航形态）', () => {
    render(<RepoTopNav repoName="alpha" />);
    // 无 status：不渲染分支名状态条
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销最近提交' })).not.toBeInTheDocument();
  });

  it('「更多」菜单仅装配注入的页面导航项（无对话框项时不含拉取/推送/更新项目/变基）', async () => {
    const onOpenTags = vi.fn();
    render(<RepoTopNav repoName="alpha" onOpenTags={onOpenTags} />);
    openMore();
    const tags = await screen.findByText('标签');
    fireEvent.click(tags);
    expect(onOpenTags).toHaveBeenCalledTimes(1);
    // 未注入的对话框项不出现
    expect(screen.queryByText('拉取')).not.toBeInTheDocument();
    expect(screen.queryByText('推送')).not.toBeInTheDocument();
    expect(screen.queryByText('更新项目')).not.toBeInTheDocument();
    expect(screen.queryByText('变基')).not.toBeInTheDocument();
  });

  it('「更多」菜单含日志页注入的对话框项：点击分发对应回调', async () => {
    const onOpenPull = vi.fn();
    render(<RepoTopNav repoName="alpha" onOpenPull={onOpenPull} />);
    openMore();
    fireEvent.click(await screen.findByText('拉取'));
    expect(onOpenPull).toHaveBeenCalledTimes(1);
  });

  it('GitHub 面板项仅在 onOpenGithub 与 githubAvailable 同传时出现', async () => {
    // onOpenTags 保底使「更多」按钮恒渲染（菜单非空），GitHub 项的显隐只受 githubAvailable 门控
    const { rerender } = render(<RepoTopNav repoName="alpha" onOpenTags={() => {}} onOpenGithub={() => {}} />);
    openMore();
    expect(screen.queryByText('GitHub 面板')).not.toBeInTheDocument();
    rerender(<RepoTopNav repoName="alpha" onOpenTags={() => {}} onOpenGithub={() => {}} githubAvailable />);
    openMore();
    expect(await screen.findByText('GitHub 面板')).toBeInTheDocument();
  });

  it('回调全缺省时不渲染任何导航按钮与「更多」', () => {
    render(<RepoTopNav repoName="alpha" />);
    for (const label of ['日志', '变更', '分支', '合并', '贮藏', '设置', '更多']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });
});
