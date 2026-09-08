import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StashEntry, StashList } from '@rebased/contracts';
import { StashPanel } from './stash-panel';

/** 测试贮藏条目工厂：补全 StashEntry 必填字段 */
function makeStash(partial: Partial<StashEntry> & { index: number }): StashEntry {
  return {
    hash: `hash${partial.index}`,
    message: `stash message ${partial.index}`,
    dateIso: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

/** 测试列表工厂 */
function makeList(stashes: StashEntry[]): StashList {
  return { stashes };
}

describe('StashPanel 空态与渲染', () => {
  it('无贮藏时列表卡渲染 EmptyState', () => {
    render(<StashPanel stashes={makeList([])} onAction={vi.fn()} />);
    expect(screen.getByText('暂无贮藏')).toBeInTheDocument();
  });

  it('行渲染 stash@{index} 徽标与 message', () => {
    render(
      <StashPanel stashes={makeList([makeStash({ index: 0, message: 'wip: fix' })])} onAction={vi.fn()} />,
    );
    const row = screen.getByTestId('row-stash-0');
    expect(row).toHaveTextContent('stash@{0}');
    expect(row).toHaveTextContent('wip: fix');
  });
});

describe('StashPanel 保存表单', () => {
  it('提交：以 {action:"save",message,includeUntracked} 调 onAction', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([])} onAction={onAction} />);
    fireEvent.change(screen.getByTestId('stash-message-input'), { target: { value: 'wip: save' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '包含未跟踪文件' }));
    fireEvent.click(screen.getByTestId('stash-save-button'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      action: 'save',
      message: 'wip: save',
      includeUntracked: true,
    });
  });

  it('未勾选时 includeUntracked 为 false，提交后表单复位', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([])} onAction={onAction} />);
    const input = screen.getByTestId('stash-message-input');
    fireEvent.change(input, { target: { value: 'msg' } });
    fireEvent.click(screen.getByTestId('stash-save-button'));
    expect(onAction).toHaveBeenCalledWith({ action: 'save', message: 'msg', includeUntracked: false });
    expect(input).toHaveValue('');
  });

  it('勾选 keep-index：提交含 {keepIndex:true}，提交后复位', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([])} onAction={onAction} />);
    fireEvent.change(screen.getByTestId('stash-message-input'), { target: { value: 'keep' } });
    fireEvent.click(screen.getByTestId('stash-keep-index'));
    fireEvent.click(screen.getByTestId('stash-save-button'));
    expect(onAction).toHaveBeenCalledWith({
      action: 'save',
      message: 'keep',
      includeUntracked: false,
      keepIndex: true,
    });
    const keepIndexBox = screen.getByTestId('stash-keep-index');
    expect(keepIndexBox).not.toBeChecked();
  });
});

describe('StashPanel 行操作', () => {
  it('"应用"：直接以 {action:"apply",index} 调 onAction', () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 1 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('apply-stash-1'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'apply', index: 1 });
  });

  it('"弹出"：Popconfirm 确认后以 {action:"pop",index} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 0 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('pop-stash-0'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'pop', index: 0 });
  });

  it('"删除"：Popconfirm 确认后以 {action:"drop",index} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 2 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('drop-stash-2'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'drop', index: 2 });
  });

  it('"转分支"：Modal 输入分支名后以 {action:"branch",index,name} 调 onAction', async () => {
    const onAction = vi.fn();
    render(<StashPanel stashes={makeList([makeStash({ index: 0 })])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('branch-stash-0'));
    fireEvent.change(await screen.findByTestId('stash-branch-name-input'), {
      target: { value: 'from-stash' },
    });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'branch', index: 0, name: 'from-stash' });
  });
});

describe('StashPanel Unstash As / 查看差异', () => {
  const LOCAL_BRANCHES = [
    { name: 'main', remote: false, current: true, upstream: null, ahead: 0, behind: 0, hash: 'a', mergedIntoHead: true, lastCommitIso: '2026-01-01T00:00:00Z' },
    { name: 'target-branch', remote: false, current: false, upstream: null, ahead: 0, behind: 0, hash: 'b', mergedIntoHead: true, lastCommitIso: '2026-01-01T00:00:00Z' },
    { name: 'origin/main', remote: true, current: false, upstream: null, ahead: 0, behind: 0, hash: 'c', mergedIntoHead: false, lastCommitIso: '2026-01-01T00:00:00Z' },
  ] as never[];

  it('Unstash As：选择本地分支（远程不出现）后回调 (index, branch)', async () => {
    const onUnstashAs = vi.fn();
    render(
      <StashPanel
        stashes={makeList([makeStash({ index: 0 })])}
        onAction={vi.fn()}
        onUnstashAs={onUnstashAs}
        branches={LOCAL_BRANCHES as never}
      />,
    );
    fireEvent.click(screen.getByTestId('unstash-as-0'));
    // Select 打开选 target-branch（选项渲染于下拉容器，可能同时命中展示区）
    fireEvent.mouseDown(screen.getByTestId('unstash-as-branch'));
    const options = await screen.findAllByText('target-branch');
    fireEvent.click(options[options.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onUnstashAs).toHaveBeenCalledWith(0, 'target-branch');
  });

  it('未传 onUnstashAs 时不渲染按钮', () => {
    render(<StashPanel stashes={makeList([makeStash({ index: 0 })])} onAction={vi.fn()} />);
    expect(screen.queryByTestId('unstash-as-0')).not.toBeInTheDocument();
  });

  it('查看差异：点击行打开 Modal 渲染 patch 文本；loading/error 态', async () => {
    const { rerender } = render(
      <StashPanel
        stashes={makeList([makeStash({ index: 0 })])}
        onAction={vi.fn()}
        stashDiff={null}
        diffLoading
      />,
    );
    fireEvent.click(screen.getByTestId('stash-diff-0'));
    expect(await screen.findByTestId('stash-diff-loading')).toBeInTheDocument();

    rerender(
      <StashPanel
        stashes={makeList([makeStash({ index: 0 })])}
        onAction={vi.fn()}
        stashDiff={{ index: 0, patch: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-v1\n+v2\n' }}
        diffLoading={false}
      />,
    );
    expect(screen.getByTestId('stash-diff-text')).toHaveTextContent('+v2');

    rerender(
      <StashPanel stashes={makeList([makeStash({ index: 0 })])} onAction={vi.fn()} stashDiff={null} diffLoading={false} diffError="贮藏不存在" />,
    );
    expect(screen.getByTestId('stash-diff-error')).toHaveTextContent('贮藏不存在');
  });
});
