import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BranchList, BranchRef } from '@rebased/contracts';
import { MergeDialog } from './merge-dialog';

/** 测试分支工厂：补全 BranchRef 必填字段，默认本地、非当前、已合并 */
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

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

const BRANCHES: BranchList = {
  branches: [
    makeBranch({ name: 'main', current: true }),
    makeBranch({ name: 'feature' }),
    makeBranch({ name: 'dev' }),
    makeBranch({ name: 'origin/main', remote: true }),
  ],
};

/** 打开分支下拉并点选指定分支（antd v6 Select：mouseDown .ant-select-content 展开、点击选项文本） */
async function selectBranch(name: string): Promise<void> {
  fireEvent.mouseDown(screen.getByTestId('merge-branch-select').querySelector('.ant-select-content')!);
  fireEvent.click(await screen.findByText(name, { selector: '.ant-select-item-option-content' }));
}

describe('MergeDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<MergeDialog open={false} branches={BRANCHES} {...makeHandlers()} />);
    expect(screen.queryByText('合并分支')).not.toBeInTheDocument();
  });

  it('分支下拉分组：本地非当前 + 远程两组（排除 current；远程 origin/* 可选）', async () => {
    render(<MergeDialog open branches={BRANCHES} {...makeHandlers()} />);
    fireEvent.mouseDown(screen.getByTestId('merge-branch-select').querySelector('.ant-select-content')!);
    expect(
      await screen.findByText('feature', { selector: '.ant-select-item-option-content' }),
    ).toBeInTheDocument();
    expect(screen.getByText('dev', { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
    expect(screen.queryByText('main', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
    // 远程分支可合并（git merge origin/xxx 直接合并远程跟踪引用）
    expect(
      screen.getByText('origin/main', { selector: '.ant-select-item-option-content' }),
    ).toBeInTheDocument();
  });

  it('选远程分支点确定：传出 {branch:"origin/main"}（远程直接合并）', async () => {
    const { onOk } = makeHandlers();
    render(<MergeDialog open branches={BRANCHES} onOk={onOk} onCancel={() => {}} />);
    await selectBranch('origin/main');
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith({ branch: 'origin/main' });
  });

  it('未选分支时确定禁用，onOk 不可触发', () => {
    const { onOk } = makeHandlers();
    render(<MergeDialog open branches={BRANCHES} onOk={onOk} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    expect(onOk).not.toHaveBeenCalled();
  });

  it('仅选分支点确定：传出 {branch}（不携带未勾选项）', async () => {
    const { onOk } = makeHandlers();
    render(<MergeDialog open branches={BRANCHES} onOk={onOk} onCancel={() => {}} />);
    await selectBranch('feature');
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith({ branch: 'feature' });
  });

  it('勾选选项后点确定：传出对应 noFf/squash/noCommit', async () => {
    const { onOk } = makeHandlers();
    render(<MergeDialog open branches={BRANCHES} onOk={onOk} onCancel={() => {}} />);
    await selectBranch('dev');
    fireEvent.click(screen.getByRole('checkbox', { name: /禁用快进/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /压缩为单提交/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ branch: 'dev', noFf: true, squash: true });
  });

  it('填写合并信息后点确定：携带 message；空白 message 不携带', async () => {
    const { onOk, unmount } = renderWithOk();
    await selectBranch('feature');
    fireEvent.change(screen.getByTestId('merge-message'), { target: { value: '合并 feature' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ branch: 'feature', message: '合并 feature' });
    unmount();

    const { onOk: onOk2 } = renderWithOk();
    await selectBranch('feature');
    fireEvent.change(screen.getByTestId('merge-message'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk2).toHaveBeenCalledWith({ branch: 'feature' });
  });

  it('点取消触发 onCancel 且不触发 onOk', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<MergeDialog open branches={BRANCHES} onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('confirming 时确定按钮进入 loading 态', () => {
    render(<MergeDialog open branches={BRANCHES} confirming {...makeHandlers()} />);
    expect(screen.getByRole('button', { name: /确\s*定/ })).toHaveClass('ant-btn-loading');
  });
});

/** 测试渲染工厂：返回 onOk 与 unmount（message 用例需二次渲染对照） */
function renderWithOk() {
  const onOk = vi.fn();
  const { unmount } = render(<MergeDialog open branches={BRANCHES} onOk={onOk} onCancel={() => {}} />);
  return { onOk, unmount };
}
