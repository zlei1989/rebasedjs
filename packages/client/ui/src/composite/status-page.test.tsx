import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEntry, RepoStatus } from '@rebased/contracts';
import { groupChanges, StatusPage } from './status-page';

/** 测试状态工厂：补全 RepoStatus 必填字段，仅注入 entries */
function makeStatus(entries: ChangeEntry[]): RepoStatus {
  return { branch: 'main', upstream: null, headHash: 'abc123', ahead: 0, behind: 0, entries };
}

/** 测试回调工厂：全部 vi.fn()，按需取用 */
function makeHandlers() {
  return {
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onDiscard: vi.fn(),
    onCommit: vi.fn(),
  };
}

/** antd v6 Checkbox 的 data-testid 直接落在内部 input 上，点击即可触发 onChange */
function clickCheckbox(testId: string): void {
  fireEvent.click(screen.getByTestId(testId));
}

describe('groupChanges', () => {
  it('M. → 仅入 staged', () => {
    const entry: ChangeEntry = { path: 'a.ts', code: 'M.' };
    const grouped = groupChanges([entry]);
    expect(grouped.staged).toEqual([entry]);
    expect(grouped.unstaged).toEqual([]);
    expect(grouped.untracked).toEqual([]);
  });

  it('.M → 仅入 unstaged', () => {
    const entry: ChangeEntry = { path: 'a.ts', code: '.M' };
    const grouped = groupChanges([entry]);
    expect(grouped.staged).toEqual([]);
    expect(grouped.unstaged).toEqual([entry]);
    expect(grouped.untracked).toEqual([]);
  });

  it('MM → 同时入 staged 与 unstaged（git status 短格式双列语义）', () => {
    const entry: ChangeEntry = { path: 'a.ts', code: 'MM' };
    const grouped = groupChanges([entry]);
    expect(grouped.staged).toEqual([entry]);
    expect(grouped.unstaged).toEqual([entry]);
    expect(grouped.untracked).toEqual([]);
  });

  it('?? → 仅入 untracked', () => {
    const entry: ChangeEntry = { path: 'new.ts', code: '??' };
    const grouped = groupChanges([entry]);
    expect(grouped.staged).toEqual([]);
    expect(grouped.unstaged).toEqual([]);
    expect(grouped.untracked).toEqual([entry]);
  });

  it('!! → 已忽略条目丢弃，不入任何组', () => {
    const grouped = groupChanges([{ path: 'ignored.log', code: '!!' }]);
    expect(grouped.staged).toEqual([]);
    expect(grouped.unstaged).toEqual([]);
    expect(grouped.untracked).toEqual([]);
  });

  it('A. → 仅入 staged', () => {
    const entry: ChangeEntry = { path: 'added.ts', code: 'A.' };
    const grouped = groupChanges([entry]);
    expect(grouped.staged).toEqual([entry]);
    expect(grouped.unstaged).toEqual([]);
    expect(grouped.untracked).toEqual([]);
  });
});

describe('StatusPage', () => {
  it('渲染三组卡片标题与计数徽标', () => {
    render(
      <StatusPage
        status={makeStatus([
          { path: 'a.ts', code: 'A.' },
          { path: 'b.ts', code: '.M' },
          { path: 'c.ts', code: '??' },
        ])}
        {...makeHandlers()}
      />,
    );
    expect(screen.getByText('已暂存（1）')).toBeInTheDocument();
    expect(screen.getByText('工作区（1）')).toBeInTheDocument();
    expect(screen.getByText('未跟踪（1）')).toBeInTheDocument();
  });

  it('勾选工作区文件后点"暂存"，以该路径数组调 onStage', () => {
    const onStage = vi.fn();
    render(
      <StatusPage status={makeStatus([{ path: 'b.ts', code: '.M' }])} {...makeHandlers()} onStage={onStage} />,
    );
    clickCheckbox('check-unstaged-b.ts');
    fireEvent.click(screen.getByTestId('stage-unstaged'));
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith(['b.ts']);
  });

  it('组头"全选"勾选后以全组路径调 onStage', () => {
    const onStage = vi.fn();
    render(
      <StatusPage
        status={makeStatus([
          { path: 'b.ts', code: '.M' },
          { path: 'c.ts', code: '.D' },
        ])}
        {...makeHandlers()}
        onStage={onStage}
      />,
    );
    clickCheckbox('select-all-unstaged');
    fireEvent.click(screen.getByTestId('stage-unstaged'));
    expect(onStage).toHaveBeenCalledWith(['b.ts', 'c.ts']);
  });

  it('勾选暂存组文件后点"取消暂存"，以该路径数组调 onUnstage', () => {
    const onUnstage = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'a.ts', code: 'M.' }])}
        {...makeHandlers()}
        onUnstage={onUnstage}
      />,
    );
    clickCheckbox('check-staged-a.ts');
    fireEvent.click(screen.getByTestId('unstage-staged'));
    expect(onUnstage).toHaveBeenCalledTimes(1);
    expect(onUnstage).toHaveBeenCalledWith(['a.ts']);
  });

  it('点"放弃"经 Popconfirm 确认后调 onDiscard', async () => {
    const onDiscard = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'b.ts', code: '.M' }])}
        {...makeHandlers()}
        onDiscard={onDiscard}
      />,
    );
    clickCheckbox('check-unstaged-b.ts');
    fireEvent.click(screen.getByTestId('discard-unstaged'));
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledWith(['b.ts']);
  });

  it('未跟踪组"删除"即 discard 语义：经 Popconfirm 确认后调 onDiscard', async () => {
    const onDiscard = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'new.ts', code: '??' }])}
        {...makeHandlers()}
        onDiscard={onDiscard}
      />,
    );
    clickCheckbox('check-untracked-new.ts');
    fireEvent.click(screen.getByTestId('discard-untracked'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onDiscard).toHaveBeenCalledWith(['new.ts']);
  });

  it('行点击触发 onSelectPatch(path, staged)：暂存组 true、工作区组 false', () => {
    const onSelectPatch = vi.fn();
    render(
      <StatusPage
        status={makeStatus([
          { path: 'a.ts', code: 'A.' },
          { path: 'b.ts', code: '.M' },
        ])}
        {...makeHandlers()}
        onSelectPatch={onSelectPatch}
      />,
    );
    fireEvent.click(screen.getByTestId('row-staged-a.ts'));
    expect(onSelectPatch).toHaveBeenCalledWith('a.ts', true);
    fireEvent.click(screen.getByTestId('row-unstaged-b.ts'));
    expect(onSelectPatch).toHaveBeenCalledWith('b.ts', false);
  });

  it('勾选行内 Checkbox 不触发行选中（onSelectPatch 不被调用）', () => {
    const onSelectPatch = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'b.ts', code: '.M' }])}
        {...makeHandlers()}
        onSelectPatch={onSelectPatch}
      />,
    );
    clickCheckbox('check-unstaged-b.ts');
    expect(onSelectPatch).not.toHaveBeenCalled();
  });

  it('提交框：message 为空时禁用，输入后点击以 { message } 调 onCommit', () => {
    const onCommit = vi.fn();
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} onCommit={onCommit} />);
    const button = screen.getByTestId('commit-button');
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId('commit-message'), { target: { value: 'feat: 新增状态页' } });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ message: 'feat: 新增状态页' });
  });

  it('勾选 amend 后占位提示变为"修改上一次提交的提交信息"', () => {
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /amend/ }));
    expect(screen.getByPlaceholderText('修改上一次提交的提交信息')).toBeInTheDocument();
  });

  it('patchLoading 时补丁预览区显示骨架', () => {
    const { container } = render(
      <StatusPage status={makeStatus([])} {...makeHandlers()} patchLoading />,
    );
    expect(container.querySelector('.ant-skeleton')).not.toBeNull();
  });

  it('patch 就绪时渲染 unified 全文', () => {
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: '@@ -1 +1 @@\n-old\n+new' }}
      />,
    );
    expect(screen.getByTestId('patch-text').textContent).toContain('@@ -1 +1 @@');
  });
});
