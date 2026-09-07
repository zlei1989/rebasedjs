/**
 * GitLabPanel 测试：提示卡两态（未检测远程 / 未配置令牌）、MR 列表（iid/title/author/
 * state 徽标 opened 绿 merged 紫 closed 灰 locked 橙 / 更新时间 / 单击选中 / 选中高亮）、
 * 详情（标题 / 元信息 / reviewState 徽标四种与 NONE 省略 / 增删行 / 主体）、时间线两种 kind、
 * 文件 diff 展开（空 diff 不渲染展开）、合并 Modal（squash Checkbox 默认不勾选、载荷与复位）、
 * 新建 MR Modal（入口位于面板根列表卡片 extra、空库 0 MR 可见、源/目标分支选择、源≠目标与
 * 标题非空校验、标题 maxLength 255、载荷、确认即关与复位）、评论 / Approve / Request changes
 * 回调、检出回调、空态与局部 loading、acting 禁用、刷新按钮缺省不渲染。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  BranchRef,
  GitLabMrDetail,
  GitLabMrFiles,
  GitLabMrList,
  GitLabMrSummary,
  GitLabStatus,
  GitLabTimeline,
} from '@rebased/contracts';
import { GitLabPanel, type GitLabPanelProps } from './gitlab-panel';

const STATUS: GitLabStatus = {
  detected: true,
  repo: { owner: 'acme/repo', name: 'repo', remoteUrl: 'https://gitlab.com/acme/repo/repo.git' },
  account: 'acme',
};

/** 测试 MR 摘要工厂：补全 GitLabMrSummary 必填字段 */
function makeMr(partial: Partial<GitLabMrSummary> & { iid: number }): GitLabMrSummary {
  return {
    title: `MR ${partial.iid}`,
    author: 'alice',
    state: 'opened',
    sourceBranch: `feature/${partial.iid}`,
    targetBranch: 'main',
    createdAtIso: '2026-07-01T08:00:00+08:00',
    updatedAtIso: '2026-08-01T10:30:00+08:00',
    ...partial,
  };
}

/** 测试分支工厂：补全 BranchRef 必填字段 */
function makeBranch(partial: Partial<BranchRef> & { name: string }): BranchRef {
  return {
    remote: false,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    hash: 'abc123',
    mergedIntoHead: true,
    lastCommitIso: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

const MRS: GitLabMrList = {
  mrs: [
    makeMr({ iid: 12, title: 'Add gitlab panel', author: 'alice', state: 'opened' }),
    makeMr({
      iid: 7,
      title: 'Fix flaky test',
      author: 'bob',
      state: 'merged',
      updatedAtIso: '2026-07-20T09:00:00+08:00',
    }),
  ],
};

const DETAIL: GitLabMrDetail = {
  ...makeMr({ iid: 12, title: 'Add gitlab panel' }),
  body: '第一行\n第二行',
  mergeable: true,
  reviewState: 'APPROVED',
  commentsCount: 0,
  additions: 12,
  deletions: 5,
};

const TIMELINE: GitLabTimeline = {
  entries: [
    { id: 1, author: 'alice', atIso: '2026-07-01T08:30:00+08:00', body: '没什么问题', kind: 'comment' },
    { id: 2, author: 'bob', atIso: '2026-07-02T09:00:00+08:00', body: '不错，批了', kind: 'review', reviewState: 'APPROVED' },
  ],
};

const FILES: GitLabMrFiles = {
  files: [
    {
      path: 'src/panel.tsx',
      status: 'added',
      additions: 40,
      deletions: 0,
      diff: 'diff --git a/src/panel.tsx b/src/panel.tsx\n@@ -0,0 +1,2 @@\n+export function panel() {}\n',
    },
    { path: 'src/old.ts', status: 'removed', additions: 0, deletions: 10, diff: '' },
  ],
};

const BRANCHES: BranchRef[] = [
  makeBranch({ name: 'main', current: true }),
  makeBranch({ name: 'feature/12' }),
  makeBranch({ name: 'dev' }),
];

/** 行级差异视图的 stub Monaco 加载器：避免 jsdom 加载真实 monaco（测试注入点） */
const STUB_LOADER: GitLabPanelProps['loader'] = async () => ({
  default: (props) => {
    const inner = props as { original: string; modified: string };
    return <div data-testid="stub-diff">{inner.original}||{inner.modified}</div>;
  },
});

/** 全量 props 渲染：缺省值可被 overrides 覆盖；返回回调替身便于断言 */
function renderPanel(overrides: Partial<GitLabPanelProps> = {}) {
  const callbacks = {
    onSelectMr: vi.fn(),
    onRefresh: vi.fn(),
    onCreateMr: vi.fn(),
    onComment: vi.fn(),
    onReview: vi.fn(),
    onMerge: vi.fn(),
    onCheckout: vi.fn(),
  };
  const props: GitLabPanelProps = {
    status: STATUS,
    mrs: MRS,
    iid: 12,
    detail: DETAIL,
    timeline: TIMELINE,
    files: FILES,
    branches: BRANCHES,
    ...callbacks,
    ...overrides,
  };
  const view = render(<GitLabPanel {...props} />);
  return { props, callbacks, view };
}

/** 打开指定 Select 下拉（antd v6 Select：mouseDown .ant-select-content 展开） */
async function selectOption(testId: string, name: string): Promise<void> {
  fireEvent.mouseDown(screen.getByTestId(testId).querySelector('.ant-select-content')!);
  // 同分支名可能出现在多个已挂载下拉中，取最后一个（最近打开的那个）
  const options = await screen.findAllByText(name, { selector: '.ant-select-item-option-content' });
  fireEvent.click(options[options.length - 1]);
}

describe('GitLabPanel 提示卡两态', () => {
  it('detected=false：渲染「未检测到 GitLab 远程」，不渲染列表与操作区', () => {
    renderPanel({ status: { detected: false } });
    expect(screen.getByText('未检测到 GitLab 远程')).toBeInTheDocument();
    expect(screen.queryByTestId('gitlab-mr-row-12')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gitlab-send-comment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gitlab-refresh')).not.toBeInTheDocument();
  });

  it('detected 但无 account：渲染「未配置 GitLab 令牌，请在设置中添加」，不渲染列表与操作区', () => {
    renderPanel({ status: { detected: true, repo: STATUS.repo } });
    expect(screen.getByText('未配置 GitLab 令牌，请在设置中添加')).toBeInTheDocument();
    expect(screen.queryByTestId('gitlab-mr-row-12')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gitlab-send-comment')).not.toBeInTheDocument();
  });
});

describe('GitLabPanel 列表', () => {
  it('行渲染：iid/title/author/state 徽标/更新时间（无独立「已合并」标记）', () => {
    renderPanel();
    const opened = screen.getByTestId('gitlab-mr-row-12');
    expect(opened).toHaveTextContent('#12');
    expect(opened).toHaveTextContent('Add gitlab panel');
    expect(opened).toHaveTextContent('alice');
    expect(within(opened).getByText('opened')).toHaveClass('ant-tag-success');
    expect(opened).toHaveTextContent('2026-08-01 10:30');

    const merged = screen.getByTestId('gitlab-mr-row-7');
    expect(within(merged).getByText('merged')).toHaveClass('ant-tag-purple');
    expect(merged).toHaveTextContent('2026-07-20 09:00');
    expect(screen.queryByText('已合并')).not.toBeInTheDocument();
  });

  it('state 徽标映射：opened 绿 / merged 紫 / closed 灰 / locked 橙', () => {
    renderPanel({
      mrs: {
        mrs: [
          makeMr({ iid: 1, state: 'opened' }),
          makeMr({ iid: 2, state: 'merged' }),
          makeMr({ iid: 3, state: 'closed' }),
          makeMr({ iid: 4, state: 'locked' }),
        ],
      },
    });
    expect(within(screen.getByTestId('gitlab-mr-row-1')).getByText('opened')).toHaveClass('ant-tag-success');
    expect(within(screen.getByTestId('gitlab-mr-row-2')).getByText('merged')).toHaveClass('ant-tag-purple');
    expect(within(screen.getByTestId('gitlab-mr-row-3')).getByText('closed')).toHaveClass('ant-tag-default');
    expect(within(screen.getByTestId('gitlab-mr-row-4')).getByText('locked')).toHaveClass('ant-tag-orange');
  });

  it('单击行调 onSelectMr(iid)；iid 命中行高亮', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('gitlab-mr-row-7'));
    expect(callbacks.onSelectMr).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectMr).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('gitlab-mr-row-12')).toHaveStyle({ backgroundColor: '#e6f4ff' });
    expect(screen.getByTestId('gitlab-mr-row-7')).not.toHaveStyle({ backgroundColor: '#e6f4ff' });
  });
});

describe('GitLabPanel 详情', () => {
  it('标题 + 元信息（author/编号/sourceBranch→targetBranch）+ 增删行统计 + 主体', () => {
    renderPanel();
    expect(screen.getByTestId('gitlab-detail-title')).toHaveTextContent('Add gitlab panel');
    expect(screen.getByTestId('gitlab-detail-author')).toHaveTextContent('alice');
    expect(screen.getByTestId('gitlab-detail-iid')).toHaveTextContent('#12');
    expect(screen.getByTestId('gitlab-detail-refs')).toHaveTextContent('feature/12 → main');
    expect(screen.getByTestId('gitlab-additions')).toHaveTextContent('+12');
    expect(screen.getByTestId('gitlab-deletions')).toHaveTextContent('-5');
    expect(screen.getByTestId('gitlab-body')).toHaveTextContent('第一行');
    expect(screen.getByTestId('gitlab-body')).toHaveTextContent('第二行');
  });

  it('reviewState 徽标：APPROVED 绿 / CHANGES_REQUESTED 橙 / REVIEW_REQUIRED 红 / NONE 省略', () => {
    const { props, view } = renderPanel();
    expect(screen.getByTestId('gitlab-review-state')).toHaveClass('ant-tag-success');
    expect(screen.getByTestId('gitlab-review-state')).toHaveTextContent('APPROVED');

    view.rerender(<GitLabPanel {...props} detail={{ ...DETAIL, reviewState: 'CHANGES_REQUESTED' }} />);
    expect(screen.getByTestId('gitlab-review-state')).toHaveClass('ant-tag-warning');

    view.rerender(<GitLabPanel {...props} detail={{ ...DETAIL, reviewState: 'REVIEW_REQUIRED' }} />);
    expect(screen.getByTestId('gitlab-review-state')).toHaveClass('ant-tag-error');

    view.rerender(<GitLabPanel {...props} detail={{ ...DETAIL, reviewState: 'NONE' }} />);
    expect(screen.queryByTestId('gitlab-review-state')).not.toBeInTheDocument();
  });
});

describe('GitLabPanel 时间线', () => {
  it('comment 与 review 两种 kind 徽标 + reviewState + author + 时间 + body', () => {
    renderPanel();
    const comment = screen.getByTestId('gitlab-timeline-1');
    expect(within(comment).getByText('评论')).toBeInTheDocument();
    expect(within(comment).getByText('alice')).toBeInTheDocument();
    expect(within(comment).getByText('2026-07-01 08:30')).toBeInTheDocument();
    expect(within(comment).getByText('没什么问题')).toBeInTheDocument();

    const review = screen.getByTestId('gitlab-timeline-2');
    expect(within(review).getByText('审查')).toBeInTheDocument();
    expect(within(review).getByText('APPROVED')).toBeInTheDocument();
    expect(within(review).getByText('bob')).toBeInTheDocument();
    expect(within(review).getByText('不错，批了')).toBeInTheDocument();
  });

  it('时间线为空渲染「暂无动态」', () => {
    renderPanel({ timeline: { entries: [] } });
    expect(screen.getByText('暂无动态')).toBeInTheDocument();
  });
});

describe('GitLabPanel 文件', () => {
  it('文件行：path/status 徽标/增删行；「查看差异」展开行级 Monaco 视图（逐 hunk），再点收起', async () => {
    renderPanel({ loader: STUB_LOADER });
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    const row = screen.getByTestId('gitlab-file-0');
    expect(row).toHaveTextContent('src/panel.tsx');
    expect(within(row).getByText('added')).toHaveClass('ant-tag-green');
    expect(within(row).getByText('+40')).toBeInTheDocument();
    expect(within(row).getByText('-0')).toBeInTheDocument();
    expect(screen.queryByTestId('hunk-diff-block-0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('gitlab-diff-toggle-0'));
    expect(await screen.findByTestId('hunk-diff-block-0')).toBeInTheDocument();
    expect(await screen.findByTestId('stub-diff')).toHaveTextContent('export function panel() {}');

    fireEvent.click(screen.getByTestId('gitlab-diff-toggle-0'));
    expect(screen.queryByTestId('hunk-diff-block-0')).not.toBeInTheDocument();
  });

  it('diff 为空串（非 renamed）时不渲染展开区', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    const row = screen.getByTestId('gitlab-file-1');
    expect(row).toHaveTextContent('src/old.ts');
    expect(within(row).getByText('removed')).toHaveClass('ant-tag-red');
    expect(screen.queryByTestId('gitlab-diff-toggle-1')).not.toBeInTheDocument();
  });

  it('文件列表为空渲染「暂无文件变更」', () => {
    renderPanel({ files: { files: [] } });
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    expect(screen.getByText('暂无文件变更')).toBeInTheDocument();
  });
});

describe('GitLabPanel 合并 Modal', () => {
  it('squash Checkbox 默认不勾选；直接确认调 onMerge(false)', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('gitlab-merge'));
    expect(await screen.findByRole('checkbox', { name: /squash/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onMerge).toHaveBeenCalledTimes(1);
    expect(callbacks.onMerge).toHaveBeenCalledWith(false);
  });

  it('勾选 squash 后确认调 onMerge(true)；再次打开默认不勾选', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('gitlab-merge'));
    fireEvent.click(await screen.findByRole('checkbox', { name: /squash/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onMerge).toHaveBeenCalledTimes(1);
    expect(callbacks.onMerge).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('gitlab-merge'));
    expect(await screen.findByRole('checkbox', { name: /squash/ })).not.toBeChecked();
  });
});

describe('GitLabPanel 评论与审查', () => {
  it('「发送评论」以输入框内容调 onComment 并清空输入', () => {
    const { callbacks } = renderPanel();
    fireEvent.change(screen.getByTestId('gitlab-comment-input'), { target: { value: '请补充测试' } });
    fireEvent.click(screen.getByTestId('gitlab-send-comment'));
    expect(callbacks.onComment).toHaveBeenCalledTimes(1);
    expect(callbacks.onComment).toHaveBeenCalledWith('请补充测试');
    expect(screen.getByTestId('gitlab-comment-input')).toHaveValue('');
  });

  it('空评论拦截：空与纯空白输入时发送按钮禁用，点击不调 onComment', () => {
    const { callbacks } = renderPanel();
    const input = screen.getByTestId('gitlab-comment-input');
    const send = screen.getByTestId('gitlab-send-comment');

    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '' } });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(send).toBeDisabled();

    fireEvent.click(send);
    expect(callbacks.onComment).not.toHaveBeenCalled();
  });

  it('空评论拦截：输入非空内容后发送按钮恢复可用', () => {
    renderPanel();
    const input = screen.getByTestId('gitlab-comment-input');
    const send = screen.getByTestId('gitlab-send-comment');

    fireEvent.change(input, { target: { value: '\t \n' } });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '  有内容  ' } });
    expect(send).toBeEnabled();
  });

  it('「Approve」Popconfirm 确认后调 onReview("APPROVE")', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('gitlab-approve'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onReview).toHaveBeenCalledTimes(1);
    expect(callbacks.onReview).toHaveBeenCalledWith('APPROVE');
  });

  it('「Request changes」确认后以输入框内容调 onReview("REQUEST_CHANGES", body)；空输入时 body 省略', async () => {
    const { callbacks, props, view } = renderPanel();
    fireEvent.change(screen.getByTestId('gitlab-comment-input'), { target: { value: '这里要改' } });
    fireEvent.click(screen.getByTestId('gitlab-request-changes'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onReview).toHaveBeenCalledTimes(1);
    expect(callbacks.onReview).toHaveBeenCalledWith('REQUEST_CHANGES', '这里要改');

    // 首次确认后输入框已清空：再次 Request changes 不携带 body
    view.rerender(<GitLabPanel {...props} />);
    fireEvent.click(screen.getByTestId('gitlab-request-changes'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onReview).toHaveBeenLastCalledWith('REQUEST_CHANGES', undefined);
  });
});

describe('GitLabPanel 检出', () => {
  it('「检出 MR 分支」调 onCheckout', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('gitlab-checkout'));
    expect(callbacks.onCheckout).toHaveBeenCalledTimes(1);
  });
});

describe('GitLabPanel 新建 MR Modal', () => {
  async function openCreateModal(): Promise<void> {
    fireEvent.click(screen.getByTestId('gitlab-create-mr'));
    await screen.findByText('新建合并请求');
  }

  it('新建入口位于面板根列表卡片 extra（详情操作区不再包含），点击可打开 Modal', async () => {
    renderPanel();
    const listCard = screen.getByText('合并请求（2）').closest<HTMLElement>('.ant-card')!;
    const detailCard = screen.getByText('MR #12').closest<HTMLElement>('.ant-card')!;
    expect(within(listCard).getByTestId('gitlab-create-mr')).toBeInTheDocument();
    expect(within(detailCard).queryByTestId('gitlab-create-mr')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gitlab-create-mr'));
    expect(await screen.findByText('新建合并请求')).toBeInTheDocument();
  });

  it('空库（0 MR 且未选中）时新建入口仍在列表卡片 extra 可见并可打开', async () => {
    renderPanel({ mrs: { mrs: [] }, iid: null, detail: null, timeline: null, files: null });
    const listCard = screen.getByText('合并请求（0）').closest<HTMLElement>('.ant-card')!;
    expect(within(listCard).getByTestId('gitlab-create-mr')).toBeInTheDocument();
    await openCreateModal();
    expect(screen.getByText('新建合并请求')).toBeInTheDocument();
  });

  it('标题输入 maxLength 255 且显示计数（与契约 gitlabMrCreateBodySchema max(255) 对齐）', async () => {
    renderPanel();
    await openCreateModal();
    const title = screen.getByTestId('gitlab-create-title');
    expect(title).toHaveAttribute('maxlength', '255');
    expect(screen.getByText(/0\s*\/\s*255/)).toBeInTheDocument();
  });

  it('三态校验：默认确定禁用；分支与标题齐全启用；源=目标重新禁用', async () => {
    renderPanel();
    await openCreateModal();
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();

    await selectOption('gitlab-create-source', 'feature/12');
    await selectOption('gitlab-create-target', 'dev');
    fireEvent.change(screen.getByTestId('gitlab-create-title'), { target: { value: '实现 X' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeEnabled();

    await selectOption('gitlab-create-target', 'feature/12');
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    expect(screen.getByText('源分支与目标分支不能相同')).toBeInTheDocument();
  });

  it('标题纯空白视为未填：确定禁用', async () => {
    renderPanel();
    await openCreateModal();
    await selectOption('gitlab-create-source', 'feature/12');
    await selectOption('gitlab-create-target', 'dev');
    fireEvent.change(screen.getByTestId('gitlab-create-title'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('确认回调 onCreateMr：携带源/目标/标题与描述；确认即关；再次打开复位', async () => {
    const { callbacks } = renderPanel();
    await openCreateModal();
    await selectOption('gitlab-create-source', 'feature/12');
    await selectOption('gitlab-create-target', 'dev');
    fireEvent.change(screen.getByTestId('gitlab-create-title'), { target: { value: '实现 X' } });
    fireEvent.change(screen.getByTestId('gitlab-create-description'), { target: { value: '说明文字' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onCreateMr).toHaveBeenCalledTimes(1);
    expect(callbacks.onCreateMr).toHaveBeenCalledWith({
      sourceBranch: 'feature/12',
      targetBranch: 'dev',
      title: '实现 X',
      description: '说明文字',
    });
    // 确认即关：组件内关闭并复位（jsdom 下 rc-dialog 关闭阶段不刷 DOM，复位以重开后的默认表单代证）
    await openCreateModal();
    expect(screen.getByTestId('gitlab-create-title')).toHaveValue('');
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('描述为空白时载荷不携带 description', async () => {
    const { callbacks } = renderPanel();
    await openCreateModal();
    await selectOption('gitlab-create-source', 'feature/12');
    await selectOption('gitlab-create-target', 'dev');
    fireEvent.change(screen.getByTestId('gitlab-create-title'), { target: { value: '实现 X' } });
    fireEvent.change(screen.getByTestId('gitlab-create-description'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onCreateMr).toHaveBeenCalledWith({
      sourceBranch: 'feature/12',
      targetBranch: 'dev',
      title: '实现 X',
    });
  });
});

describe('GitLabPanel 空态与局部 loading', () => {
  it('查无 MR（当前筛选）渲染「暂无合并请求」', () => {
    renderPanel({ mrs: { mrs: [] } });
    expect(screen.getByText('暂无合并请求')).toBeInTheDocument();
  });

  it('iid 为 null 时不渲染详情列内容', () => {
    renderPanel({ iid: null, detail: null, timeline: null, files: null });
    expect(screen.queryByTestId('gitlab-detail-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gitlab-send-comment')).not.toBeInTheDocument();
  });

  it('选中 MR 但 detail 为 null：详情列局部 loading', () => {
    renderPanel({ detail: null, timeline: null, files: null });
    expect(screen.getByTestId('gitlab-detail-loading')).toBeInTheDocument();
  });

  it('列表 loading 时显示 Spin', () => {
    renderPanel({ loading: true });
    expect(screen.getByTestId('gitlab-loading')).toBeInTheDocument();
  });
});

describe('GitLabPanel acting 与刷新', () => {
  it('acting 时操作按钮全部禁用（含刷新）', () => {
    renderPanel({ acting: true });
    expect(screen.getByTestId('gitlab-send-comment')).toBeDisabled();
    expect(screen.getByTestId('gitlab-approve')).toBeDisabled();
    expect(screen.getByTestId('gitlab-request-changes')).toBeDisabled();
    expect(screen.getByTestId('gitlab-merge')).toBeDisabled();
    expect(screen.getByTestId('gitlab-checkout')).toBeDisabled();
    expect(screen.getByTestId('gitlab-create-mr')).toBeDisabled();
    expect(screen.getByTestId('gitlab-refresh')).toBeDisabled();
  });

  it('点击「刷新」调 onRefresh', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('gitlab-refresh'));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('onRefresh 缺省时不渲染刷新按钮', () => {
    renderPanel({ onRefresh: undefined });
    expect(screen.queryByTestId('gitlab-refresh')).not.toBeInTheDocument();
  });
});
