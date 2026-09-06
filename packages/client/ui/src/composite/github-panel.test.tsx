/**
 * GitHubPanel 测试：提示卡两态（未检测远程 / 未配置令牌）、PR 列表（number/title/author/
 * state 徽标 open 绿 closed 灰 / 已合并标记 / 更新时间 / 单击选中 / 选中高亮）、详情（标题 /
 * 元信息 / reviewDecision 徽标四种与 NONE 省略 / 增删行 / 主体）、时间线两种 kind、文件
 * patch 展开（空 patch 不渲染展开）、合并 Modal 三方法载荷、评论 / Approve / Request changes
 * 回调、检出回调、空态与局部 loading、acting 禁用、刷新按钮缺省不渲染、空评论拦截
 * （空/纯空白时发送按钮禁用、非空恢复可用）。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  GitHubPrDetail,
  GitHubPrFiles,
  GitHubPrList,
  GitHubPrSummary,
  GitHubStatus,
  GitHubTimeline,
} from '@rebased/contracts';
import { GitHubPanel, type GitHubPanelProps } from './github-panel';

const STATUS: GitHubStatus = {
  detected: true,
  repo: { owner: 'acme', name: 'repo', remoteUrl: 'https://github.com/acme/repo.git' },
  account: 'acme',
};

/** 测试 PR 摘要工厂：补全 GitHubPrSummary 必填字段 */
function makePr(partial: Partial<GitHubPrSummary> & { number: number }): GitHubPrSummary {
  return {
    title: `PR ${partial.number}`,
    author: 'alice',
    state: 'open',
    merged: false,
    baseRef: 'main',
    headRef: `feature/${partial.number}`,
    createdAtIso: '2026-07-01T08:00:00+08:00',
    updatedAtIso: '2026-08-01T10:30:00+08:00',
    ...partial,
  };
}

const PRS: GitHubPrList = {
  prs: [
    makePr({ number: 12, title: 'Add github panel', author: 'alice', state: 'open' }),
    makePr({
      number: 7,
      title: 'Fix flaky test',
      author: 'bob',
      state: 'closed',
      merged: true,
      updatedAtIso: '2026-07-20T09:00:00+08:00',
    }),
  ],
};

const DETAIL: GitHubPrDetail = {
  ...makePr({ number: 12, title: 'Add github panel' }),
  body: '第一行\n第二行',
  mergeable: true,
  reviewDecision: 'APPROVED',
  commentsCount: 0,
  additions: 12,
  deletions: 5,
};

const TIMELINE: GitHubTimeline = {
  entries: [
    { id: 1, author: 'alice', atIso: '2026-07-01T08:30:00+08:00', body: '没什么问题', kind: 'comment' },
    { id: 2, author: 'bob', atIso: '2026-07-02T09:00:00+08:00', body: '不错，批了', kind: 'review', reviewState: 'APPROVED' },
  ],
};

const FILES: GitHubPrFiles = {
  files: [
    {
      path: 'src/panel.tsx',
      status: 'added',
      additions: 40,
      deletions: 0,
      patch: 'diff --git a/src/panel.tsx b/src/panel.tsx\n+export function panel() {}',
    },
    { path: 'src/old.ts', status: 'removed', additions: 0, deletions: 10, patch: '' },
  ],
};

/** 全量 props 渲染：缺省值可被 overrides 覆盖；返回回调替身便于断言 */
function renderPanel(overrides: Partial<GitHubPanelProps> = {}) {
  const callbacks = {
    onSelectPr: vi.fn(),
    onRefresh: vi.fn(),
    onComment: vi.fn(),
    onReview: vi.fn(),
    onMerge: vi.fn(),
    onCheckout: vi.fn(),
  };
  const props: GitHubPanelProps = {
    status: STATUS,
    prs: PRS,
    number: 12,
    detail: DETAIL,
    timeline: TIMELINE,
    files: FILES,
    ...callbacks,
    ...overrides,
  };
  const view = render(<GitHubPanel {...props} />);
  return { props, callbacks, view };
}

describe('GitHubPanel 提示卡两态', () => {
  it('detected=false：渲染「未检测到 GitHub 远程」，不渲染列表与操作区', () => {
    renderPanel({ status: { detected: false } });
    expect(screen.getByText('未检测到 GitHub 远程')).toBeInTheDocument();
    expect(screen.queryByTestId('github-pr-row-12')).not.toBeInTheDocument();
    expect(screen.queryByTestId('github-send-comment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('github-refresh')).not.toBeInTheDocument();
  });

  it('detected 但无 account：渲染「未配置 GitHub 令牌，请在设置中添加」，不渲染列表与操作区', () => {
    renderPanel({ status: { detected: true, repo: STATUS.repo } });
    expect(screen.getByText('未配置 GitHub 令牌，请在设置中添加')).toBeInTheDocument();
    expect(screen.queryByTestId('github-pr-row-12')).not.toBeInTheDocument();
    expect(screen.queryByTestId('github-send-comment')).not.toBeInTheDocument();
  });
});

describe('GitHubPanel 列表', () => {
  it('行渲染：number/title/author/state 徽标（open 绿/closed 灰）+ 已合并标记 + 更新时间', () => {
    renderPanel();
    const open = screen.getByTestId('github-pr-row-12');
    expect(open).toHaveTextContent('#12');
    expect(open).toHaveTextContent('Add github panel');
    expect(open).toHaveTextContent('alice');
    expect(within(open).getByText('open')).toHaveClass('ant-tag-success');
    expect(open).toHaveTextContent('2026-08-01 10:30');

    const closed = screen.getByTestId('github-pr-row-7');
    expect(within(closed).getByText('closed')).toHaveClass('ant-tag-default');
    expect(within(closed).getByText('已合并')).toBeInTheDocument();
    expect(closed).toHaveTextContent('2026-07-20 09:00');
  });

  it('单击行调 onSelectPr(number)；number 命中行高亮', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('github-pr-row-7'));
    expect(callbacks.onSelectPr).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectPr).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('github-pr-row-12')).toHaveStyle({ backgroundColor: '#e6f4ff' });
    expect(screen.getByTestId('github-pr-row-7')).not.toHaveStyle({ backgroundColor: '#e6f4ff' });
  });
});

describe('GitHubPanel 详情', () => {
  it('标题 + 元信息（author/编号/baseRef←headRef）+ 增删行统计 + 主体', () => {
    renderPanel();
    expect(screen.getByTestId('github-detail-title')).toHaveTextContent('Add github panel');
    expect(screen.getByTestId('github-detail-author')).toHaveTextContent('alice');
    expect(screen.getByTestId('github-detail-number')).toHaveTextContent('#12');
    expect(screen.getByTestId('github-detail-refs')).toHaveTextContent('main ← feature/12');
    expect(screen.getByTestId('github-additions')).toHaveTextContent('+12');
    expect(screen.getByTestId('github-deletions')).toHaveTextContent('-5');
    expect(screen.getByTestId('github-body')).toHaveTextContent('第一行');
    expect(screen.getByTestId('github-body')).toHaveTextContent('第二行');
  });

  it('reviewDecision 徽标：APPROVED 绿 / CHANGES_REQUESTED 橙 / REVIEW_REQUIRED 红 / NONE 省略', () => {
    const { props, view } = renderPanel();
    expect(screen.getByTestId('github-review-decision')).toHaveClass('ant-tag-success');
    expect(screen.getByTestId('github-review-decision')).toHaveTextContent('APPROVED');

    view.rerender(<GitHubPanel {...props} detail={{ ...DETAIL, reviewDecision: 'CHANGES_REQUESTED' }} />);
    expect(screen.getByTestId('github-review-decision')).toHaveClass('ant-tag-warning');

    view.rerender(<GitHubPanel {...props} detail={{ ...DETAIL, reviewDecision: 'REVIEW_REQUIRED' }} />);
    expect(screen.getByTestId('github-review-decision')).toHaveClass('ant-tag-error');

    view.rerender(<GitHubPanel {...props} detail={{ ...DETAIL, reviewDecision: 'NONE' }} />);
    expect(screen.queryByTestId('github-review-decision')).not.toBeInTheDocument();
  });
});

describe('GitHubPanel 时间线', () => {
  it('comment 与 review 两种 kind 徽标 + author + 时间 + body', () => {
    renderPanel();
    const comment = screen.getByTestId('github-timeline-1');
    expect(within(comment).getByText('评论')).toBeInTheDocument();
    expect(within(comment).getByText('alice')).toBeInTheDocument();
    expect(within(comment).getByText('2026-07-01 08:30')).toBeInTheDocument();
    expect(within(comment).getByText('没什么问题')).toBeInTheDocument();

    const review = screen.getByTestId('github-timeline-2');
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

describe('GitHubPanel 文件', () => {
  it('文件行：path/status 徽标/增删行；「查看补丁」展开 patch 文本，再点收起', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    const row = screen.getByTestId('github-file-0');
    expect(row).toHaveTextContent('src/panel.tsx');
    expect(within(row).getByText('added')).toHaveClass('ant-tag-green');
    expect(within(row).getByText('+40')).toBeInTheDocument();
    expect(within(row).getByText('-0')).toBeInTheDocument();
    expect(screen.queryByTestId('github-patch-0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('github-patch-toggle-0'));
    expect(screen.getByTestId('github-patch-0')).toHaveTextContent('diff --git a/src/panel.tsx');

    fireEvent.click(screen.getByTestId('github-patch-toggle-0'));
    expect(screen.queryByTestId('github-patch-0')).not.toBeInTheDocument();
  });

  it('patch 为空串时不渲染展开区', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    const row = screen.getByTestId('github-file-1');
    expect(row).toHaveTextContent('src/old.ts');
    expect(within(row).getByText('removed')).toHaveClass('ant-tag-red');
    expect(screen.queryByTestId('github-patch-toggle-1')).not.toBeInTheDocument();
  });

  it('文件列表为空渲染「暂无文件变更」', () => {
    renderPanel({ files: { files: [] } });
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    expect(screen.getByText('暂无文件变更')).toBeInTheDocument();
  });
});

describe('GitHubPanel 合并 Modal', () => {
  it('默认 merge；切换 squash 后确认调 onMerge("squash")', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('github-merge'));
    expect(await screen.findByRole('radio', { name: /创建合并提交/ })).toBeChecked();
    const squash = screen.getByRole('radio', { name: /压缩为单个提交/ });
    expect(squash).not.toBeChecked();
    fireEvent.click(squash);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onMerge).toHaveBeenCalledTimes(1);
    expect(callbacks.onMerge).toHaveBeenCalledWith('squash');
  });

  it('切换 rebase 确认调 onMerge("rebase")；再次打开默认 merge', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('github-merge'));
    fireEvent.click(await screen.findByRole('radio', { name: /变基合并/ }));
    // 注意：Modal 打开时 Popconfirm 未开，只有一个「确 定」按钮
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onMerge).toHaveBeenLastCalledWith('rebase');

    fireEvent.click(screen.getByTestId('github-merge'));
    expect(await screen.findByRole('radio', { name: /创建合并提交/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onMerge).toHaveBeenCalledTimes(2);
    expect(callbacks.onMerge).toHaveBeenLastCalledWith('merge');
  });
});

describe('GitHubPanel 评论与审查', () => {
  it('「发送评论」以输入框内容调 onComment 并清空输入', () => {
    const { callbacks } = renderPanel();
    fireEvent.change(screen.getByTestId('github-comment-input'), { target: { value: '请补充测试' } });
    fireEvent.click(screen.getByTestId('github-send-comment'));
    expect(callbacks.onComment).toHaveBeenCalledTimes(1);
    expect(callbacks.onComment).toHaveBeenCalledWith('请补充测试');
    expect(screen.getByTestId('github-comment-input')).toHaveValue('');
  });

  it('空评论拦截：空与纯空白输入时发送按钮禁用，点击不调 onComment', () => {
    const { callbacks } = renderPanel();
    const input = screen.getByTestId('github-comment-input');
    const send = screen.getByTestId('github-send-comment');

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
    const input = screen.getByTestId('github-comment-input');
    const send = screen.getByTestId('github-send-comment');

    fireEvent.change(input, { target: { value: '\t \n' } });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '  有内容  ' } });
    expect(send).toBeEnabled();
  });

  it('「Approve」Popconfirm 确认后调 onReview("APPROVE")', async () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('github-approve'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onReview).toHaveBeenCalledTimes(1);
    expect(callbacks.onReview).toHaveBeenCalledWith('APPROVE');
  });

  it('「Request changes」确认后以输入框内容调 onReview("REQUEST_CHANGES", body)', async () => {
    const { callbacks } = renderPanel();
    fireEvent.change(screen.getByTestId('github-comment-input'), { target: { value: '这里要改' } });
    fireEvent.click(screen.getByTestId('github-request-changes'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(callbacks.onReview).toHaveBeenCalledTimes(1);
    expect(callbacks.onReview).toHaveBeenCalledWith('REQUEST_CHANGES', '这里要改');
  });
});

describe('GitHubPanel 检出', () => {
  it('「检出分支」调 onCheckout', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('github-checkout'));
    expect(callbacks.onCheckout).toHaveBeenCalledTimes(1);
  });
});

describe('GitHubPanel 空态与局部 loading', () => {
  it('查无 PR（当前筛选）渲染「暂无拉取请求」', () => {
    renderPanel({ prs: { prs: [] } });
    expect(screen.getByText('暂无拉取请求')).toBeInTheDocument();
  });

  it('number 为 null 时不渲染详情列内容', () => {
    renderPanel({ number: null, detail: null, timeline: null, files: null });
    expect(screen.queryByTestId('github-detail-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('github-send-comment')).not.toBeInTheDocument();
  });

  it('选中 PR 但 detail 为 null：详情列局部 loading', () => {
    renderPanel({ detail: null, timeline: null, files: null });
    expect(screen.getByTestId('github-detail-loading')).toBeInTheDocument();
  });

  it('列表 loading 时显示 Spin', () => {
    renderPanel({ loading: true });
    expect(screen.getByTestId('github-loading')).toBeInTheDocument();
  });
});

describe('GitHubPanel acting 与刷新', () => {
  it('acting 时操作按钮全部禁用（含刷新）', () => {
    renderPanel({ acting: true });
    expect(screen.getByTestId('github-send-comment')).toBeDisabled();
    expect(screen.getByTestId('github-approve')).toBeDisabled();
    expect(screen.getByTestId('github-request-changes')).toBeDisabled();
    expect(screen.getByTestId('github-merge')).toBeDisabled();
    expect(screen.getByTestId('github-checkout')).toBeDisabled();
    expect(screen.getByTestId('github-refresh')).toBeDisabled();
  });

  it('点击「刷新」调 onRefresh', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('github-refresh'));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('onRefresh 缺省时不渲染刷新按钮', () => {
    renderPanel({ onRefresh: undefined });
    expect(screen.queryByTestId('github-refresh')).not.toBeInTheDocument();
  });
});
