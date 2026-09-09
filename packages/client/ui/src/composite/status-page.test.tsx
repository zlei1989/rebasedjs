import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEntry, ChangelistView, RepoStatus } from '@rebased/contracts';
import { groupByChangelist, groupChanges, StatusPage } from './status-page';

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

  it('提交框：onCommitAndPush 提供时渲染「提交并推送」，message 空禁用，输入后点按以 { message } 调回调（含可选标志）', () => {
    const onCommitAndPush = vi.fn();
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} onCommitAndPush={onCommitAndPush} />);
    const button = screen.getByTestId('commit-and-push-button');
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /amend/ }));
    fireEvent.change(screen.getByTestId('commit-message'), { target: { value: 'feat: 组合' } });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onCommitAndPush).toHaveBeenCalledTimes(1);
    expect(onCommitAndPush).toHaveBeenCalledWith({ message: 'feat: 组合', amend: true });
  });

  it('onCommitAndPush 缺省时不渲染「提交并推送」（向后兼容）', () => {
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} />);
    expect(screen.queryByTestId('commit-and-push-button')).not.toBeInTheDocument();
  });

  it('勾选 amend 后占位提示变为"修改上一次提交的提交信息"', () => {
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /amend/ }));
    expect(screen.getByPlaceholderText('修改上一次提交的提交信息')).toBeInTheDocument();
  });

  it('提交框：「amend 到…」下拉列目标；选中后以 {targetHash,message} 调 onAmendSpecific 且 amend 复选框禁用', async () => {
    const onAmendSpecific = vi.fn();
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        amendTargets={[
          { hash: 'a'.repeat(40), subject: 'c2' },
          { hash: 'b'.repeat(40), subject: 'c1' },
        ]}
        onAmendSpecific={onAmendSpecific}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId('amend-target-select'));
    const options = await screen.findAllByText(/Amend c2/);
    fireEvent.click(options[options.length - 1]);
    // 指定目标后 amend 复选框禁用（与「改上次提交」互斥）
    expect(screen.getByRole('checkbox', { name: /amend/ })).toBeDisabled();

    fireEvent.change(screen.getByTestId('commit-message'), { target: { value: 'c2（重写）' } });
    fireEvent.click(screen.getByTestId('commit-button'));
    expect(onAmendSpecific).toHaveBeenCalledTimes(1);
    expect(onAmendSpecific).toHaveBeenCalledWith({ targetHash: 'a'.repeat(40), message: 'c2（重写）' });
  });

  it('提交框：未选目标时提交仍走 onCommit；未传 onAmendSpecific 不渲染下拉（向后兼容）', () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        onCommit={onCommit}
        amendTargets={[]}
        onAmendSpecific={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('commit-message'), { target: { value: '普通提交' } });
    fireEvent.click(screen.getByTestId('commit-button'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ message: '普通提交' });

    rerender(<StatusPage status={makeStatus([])} {...makeHandlers()} onCommit={onCommit} />);
    expect(screen.queryByTestId('amend-target-select')).not.toBeInTheDocument();
  });

  it('提交框：指定目标后「提交并推送」禁用（组合执行器不支持指定目标）', async () => {
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        onCommitAndPush={vi.fn()}
        amendTargets={[{ hash: 'a'.repeat(40), subject: 'c2' }]}
        onAmendSpecific={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId('amend-target-select'));
    const options = await screen.findAllByText(/Amend c2/);
    fireEvent.click(options[options.length - 1]);
    expect(screen.getByTestId('commit-and-push-button')).toBeDisabled();
  });

  it('CRLF 提示：crlfFiles 非空渲染警告内联提示（GitCrlfDialog 语义）；空/缺省不渲染', () => {
    const { rerender } = render(
      <StatusPage status={makeStatus([])} {...makeHandlers()} crlfFiles={['a.txt', 'b.txt']} />,
    );
    expect(screen.getByTestId('crlf-warning')).toHaveTextContent('CRLF 行尾符');
    expect(screen.getByTestId('crlf-warning')).toHaveTextContent('a.txt、b.txt');

    rerender(<StatusPage status={makeStatus([])} {...makeHandlers()} />);
    expect(screen.queryByTestId('crlf-warning')).not.toBeInTheDocument();
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

/** 双 hunk 补丁夹具：头部 + 两个 @@（第二个带函数上下文标题） */
const PATCH_TEXT =
  'diff --git a/a.ts b/a.ts\nindex 111..222 100644\n--- a/a.ts\n+++ b/a.ts\n' +
  '@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n' +
  '@@ -10,3 +10,4 @@ fn bar()\n more\n+added\n';

describe('StatusPage hunk 级操作', () => {
  it('未传 onHunkStaging 时保持纯文本渲染（向后兼容）', () => {
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} patch={{ path: 'a.ts', text: PATCH_TEXT }} />);
    expect(screen.getByTestId('patch-text')).toBeInTheDocument();
    expect(screen.queryByTestId('hunk-check-0')).not.toBeInTheDocument();
  });

  it('传 onHunkStaging 时按 hunk 切片渲染（勾选 + 头行标题）', () => {
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: PATCH_TEXT }}
        onHunkStaging={vi.fn()}
      />,
    );
    expect(screen.getByTestId('hunk-check-0')).toBeInTheDocument();
    expect(screen.getByTestId('hunk-check-1')).toBeInTheDocument();
    expect(screen.getByText('fn bar()')).toBeInTheDocument();
    // 工作区视图：暂存/放弃按钮在位，未勾选时禁用
    expect(screen.getByTestId('hunk-stage').closest('button')).toBeDisabled();
    expect(screen.getByTestId('hunk-discard').closest('button')).toBeDisabled();
  });

  it('工作区视图：勾选 hunk → 暂存选中发 {action:stage,file,hunks:[索引]}', () => {
    const onHunkStaging = vi.fn();
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: PATCH_TEXT }}
        onHunkStaging={onHunkStaging}
      />,
    );
    fireEvent.click(screen.getByTestId('hunk-check-0'));
    fireEvent.click(screen.getByTestId('hunk-check-1'));
    fireEvent.click(screen.getByTestId('hunk-stage'));
    expect(onHunkStaging).toHaveBeenCalledWith({ action: 'stage', file: 'a.ts', hunks: [0, 1] });
  });

  it('工作区视图：放弃选中经 Popconfirm 确认发 {action:discard}', async () => {
    const onHunkStaging = vi.fn();
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: PATCH_TEXT }}
        onHunkStaging={onHunkStaging}
      />,
    );
    fireEvent.click(screen.getByTestId('hunk-check-0'));
    fireEvent.click(screen.getByTestId('hunk-discard'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onHunkStaging).toHaveBeenCalledWith({ action: 'discard', file: 'a.ts', hunks: [0] });
  });

  it('已暂存视图：仅「取消暂存选中」，发 {action:unstage}', () => {
    const onHunkStaging = vi.fn();
    render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: PATCH_TEXT }}
        previewStaged
        onHunkStaging={onHunkStaging}
      />,
    );
    expect(screen.queryByTestId('hunk-stage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hunk-discard')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('hunk-check-1'));
    fireEvent.click(screen.getByTestId('hunk-unstage'));
    expect(onHunkStaging).toHaveBeenCalledWith({ action: 'unstage', file: 'a.ts', hunks: [1] });
  });

  it('切换文件或补丁文本变化时勾选复位（hunk 编号随当前 diff 重算，旧勾选会错位）', () => {
    const { rerender } = render(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: PATCH_TEXT }}
        onHunkStaging={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('hunk-check-0'));
    expect(screen.getByTestId('hunk-check-0')).toBeChecked();
    // 同文件新补丁文本：部分暂存后服务端重算编号的场景
    rerender(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'a.ts', text: '@@ -10,3 +10,4 @@ fn bar()\n more\n+added\n' }}
        onHunkStaging={vi.fn()}
      />,
    );
    expect(screen.getByTestId('hunk-check-0')).not.toBeChecked();
    // 切换文件：同样复位
    fireEvent.click(screen.getByTestId('hunk-check-0'));
    rerender(
      <StatusPage
        status={makeStatus([])}
        {...makeHandlers()}
        patch={{ path: 'b.ts', text: PATCH_TEXT }}
        onHunkStaging={vi.fn()}
      />,
    );
    expect(screen.getByTestId('hunk-check-0')).not.toBeChecked();
  });
});

/** 测试变更列表视图工厂：默认列表 + 两个普通列表；assignments 按需覆盖 */
function makeChangelists(assignments: Record<string, string> = {}): ChangelistView {
  return {
    lists: [
      { id: 'cl-default', name: '默认列表', isDefault: true },
      { id: 'cl-feat', name: '功能A', isDefault: false },
      { id: 'cl-fix', name: '修复B', isDefault: false },
    ],
    assignments,
  };
}

describe('groupByChangelist', () => {
  it('按 assignments 分组：已指派路径归对应 listId，未指派归 "default"', () => {
    const a: ChangeEntry = { path: 'a.ts', code: '.M' };
    const b: ChangeEntry = { path: 'b.ts', code: '.M' };
    const c: ChangeEntry = { path: 'c.ts', code: '.M' };
    const grouped = groupByChangelist([a, b, c], makeChangelists({ 'a.ts': 'cl-feat', 'b.ts': 'cl-fix' }));
    expect(grouped.get('cl-feat')).toEqual([a]);
    expect(grouped.get('cl-fix')).toEqual([b]);
    expect(grouped.get('default')).toEqual([c]);
  });

  it('孤儿指派（目标列表已不存在）回退 "default"', () => {
    const a: ChangeEntry = { path: 'a.ts', code: '.M' };
    const view = makeChangelists({ 'a.ts': 'cl-gone' });
    const grouped = groupByChangelist([a], view);
    expect(grouped.get('default')).toEqual([a]);
    expect(grouped.has('cl-gone')).toBe(false);
  });

  it('显式指派到默认列表 id 也归 "default" 键', () => {
    const a: ChangeEntry = { path: 'a.ts', code: '.M' };
    const grouped = groupByChangelist([a], makeChangelists({ 'a.ts': 'cl-default' }));
    expect(grouped.get('default')).toEqual([a]);
    expect(grouped.has('cl-default')).toBe(false);
  });
});

describe('StatusPage changelists', () => {
  /** 工作区三条：a.ts→功能A、b.ts→修复B、c.ts 未指派（默认列表） */
  const entries: ChangeEntry[] = [
    { path: 'a.ts', code: '.M' },
    { path: 'b.ts', code: '.M' },
    { path: 'c.ts', code: '.M' },
  ];
  const changelists = makeChangelists({ 'a.ts': 'cl-feat', 'b.ts': 'cl-fix' });

  it('changelists 提供时按列表子分组：非默认列表渲染子标题（带计数），默认列表无子标题', () => {
    render(
      <StatusPage
        status={makeStatus(entries)}
        {...makeHandlers()}
        changelists={changelists}
        onChangelistAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId('subtitle-unstaged-cl-feat')).toHaveTextContent('功能A（1）');
    expect(screen.getByTestId('subtitle-unstaged-cl-fix')).toHaveTextContent('修复B（1）');
    // 默认列表条目平铺：不渲染其子标题
    expect(screen.queryByTestId('subtitle-unstaged-cl-default')).toBeNull();
    // 三条行均仍渲染
    expect(screen.getByTestId('row-unstaged-a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('row-unstaged-b.ts')).toBeInTheDocument();
    expect(screen.getByTestId('row-unstaged-c.ts')).toBeInTheDocument();
  });

  it('行级「移动到列表」：行未勾选时仅移动该行，载荷 {action:"move",paths:[该行],targetId}', async () => {
    const onChangelistAction = vi.fn();
    render(
      <StatusPage
        status={makeStatus(entries)}
        {...makeHandlers()}
        changelists={changelists}
        onChangelistAction={onChangelistAction}
      />,
    );
    // b.ts 当前在「修复B」：目标菜单只列非当前列表（默认列表 + 功能A）
    fireEvent.click(screen.getByTestId('move-unstaged-b.ts'));
    fireEvent.click(await screen.findByText('功能A'));
    expect(onChangelistAction).toHaveBeenCalledTimes(1);
    expect(onChangelistAction).toHaveBeenCalledWith({ action: 'move', paths: ['b.ts'], targetId: 'cl-feat' });
  });

  it('行级「移动到列表」：行已勾选时按当前选中集合批量移动', async () => {
    const onChangelistAction = vi.fn();
    render(
      <StatusPage
        status={makeStatus(entries)}
        {...makeHandlers()}
        changelists={changelists}
        onChangelistAction={onChangelistAction}
      />,
    );
    clickCheckbox('check-unstaged-a.ts');
    clickCheckbox('check-unstaged-c.ts');
    // 在已勾选的 a.ts 行上打开移动菜单：操作整个选中集合
    fireEvent.click(screen.getByTestId('move-unstaged-a.ts'));
    fireEvent.click(await screen.findByText('修复B'));
    expect(onChangelistAction).toHaveBeenCalledWith({
      action: 'move',
      paths: ['a.ts', 'c.ts'],
      targetId: 'cl-fix',
    });
  });

  it('管理列表「新建列表」：Modal 输入名称后以 {action:"create",name} 回调', async () => {
    const onChangelistAction = vi.fn();
    render(
      <StatusPage
        status={makeStatus(entries)}
        {...makeHandlers()}
        changelists={changelists}
        onChangelistAction={onChangelistAction}
      />,
    );
    fireEvent.click(screen.getByTestId('manage-changelists'));
    fireEvent.click(await screen.findByText('新建列表'));
    fireEvent.change(await screen.findByTestId('cl-create-name'), { target: { value: '新列表' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onChangelistAction).toHaveBeenCalledTimes(1);
    expect(onChangelistAction).toHaveBeenCalledWith({ action: 'create', name: '新列表' });
  });

  it('管理列表：默认列表的「删除」菜单项禁用', async () => {
    render(
      <StatusPage
        status={makeStatus(entries)}
        {...makeHandlers()}
        changelists={changelists}
        onChangelistAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('manage-changelists'));
    const deleteItem = await screen.findByTestId('cl-delete-cl-default');
    expect(deleteItem.closest('li')).toHaveClass('ant-dropdown-menu-item-disabled');
  });

  it('changelists 缺省时无管理入口与行级移动按钮（向后兼容三分组现状）', () => {
    render(<StatusPage status={makeStatus(entries)} {...makeHandlers()} />);
    expect(screen.queryByTestId('manage-changelists')).toBeNull();
    expect(screen.queryByTestId('move-unstaged-a.ts')).toBeNull();
    expect(screen.queryByTestId('subtitle-unstaged-cl-feat')).toBeNull();
  });
});

describe('StatusPage 忽略入口', () => {
  it('onIgnore 提供时未跟踪行渲染「忽略」按钮，点击以路径调 onIgnore', () => {
    const onIgnore = vi.fn();
    render(
      <StatusPage status={makeStatus([{ path: 'new.ts', code: '??' }])} {...makeHandlers()} onIgnore={onIgnore} />,
    );
    const button = screen.getByTestId('ignore-untracked-new.ts');
    expect(button).toHaveTextContent('忽略');
    fireEvent.click(button);
    expect(onIgnore).toHaveBeenCalledTimes(1);
    expect(onIgnore).toHaveBeenCalledWith('new.ts');
  });

  it('点击「忽略」不触发行选中（onSelectPatch 不被调用）', () => {
    const onSelectPatch = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'new.ts', code: '??' }])}
        {...makeHandlers()}
        onSelectPatch={onSelectPatch}
        onIgnore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('ignore-untracked-new.ts'));
    expect(onSelectPatch).not.toHaveBeenCalled();
  });

  it('「三版本」行按钮：已暂存/工作区组渲染（未跟踪不渲染），点击回调带路径且不触发行选中', () => {
    const onSelectPatch = vi.fn();
    const onOpenThreeWay = vi.fn();
    render(
      <StatusPage
        status={makeStatus([
          { path: 'staged.ts', code: 'M.' },
          { path: 'work.ts', code: '.M' },
          { path: 'new.ts', code: '??' },
        ])}
        {...makeHandlers()}
        onSelectPatch={onSelectPatch}
        onOpenThreeWay={onOpenThreeWay}
      />,
    );
    fireEvent.click(screen.getByTestId('three-way-staged-staged.ts'));
    expect(onOpenThreeWay).toHaveBeenCalledWith('staged.ts');
    fireEvent.click(screen.getByTestId('three-way-unstaged-work.ts'));
    expect(onOpenThreeWay).toHaveBeenCalledWith('work.ts');
    expect(screen.queryByTestId('three-way-untracked-new.ts')).not.toBeInTheDocument();
    expect(onSelectPatch).not.toHaveBeenCalled();
  });

  it('未传 onOpenThreeWay 时不渲染「三版本」按钮', () => {
    render(<StatusPage status={makeStatus([{ path: 'a.ts', code: 'M.' }])} {...makeHandlers()} />);
    expect(screen.queryByTestId('three-way-staged-a.ts')).not.toBeInTheDocument();
  });

  it('onIgnore 缺省时未跟踪行不渲染「忽略」（向后兼容）', () => {
    render(<StatusPage status={makeStatus([{ path: 'new.ts', code: '??' }])} {...makeHandlers()} />);
    expect(screen.queryByTestId('ignore-untracked-new.ts')).not.toBeInTheDocument();
  });

  it('onIgnore 仅作用于未跟踪组：暂存/工作区行不渲染「忽略」', () => {
    render(
      <StatusPage
        status={makeStatus([
          { path: 'a.ts', code: 'M.' },
          { path: 'b.ts', code: '.M' },
        ])}
        {...makeHandlers()}
        onIgnore={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('ignore-staged-a.ts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ignore-unstaged-b.ts')).not.toBeInTheDocument();
  });
});

describe('StatusPage 页级动作（Create Patch / Shelve / Stash / Annotate / History）', () => {
  it('行内「注解」：各组件行渲染，点击回调带路径且不触发行选中', () => {
    const onSelectPatch = vi.fn();
    const onOpenAnnotate = vi.fn();
    render(
      <StatusPage
        status={makeStatus([
          { path: 'a.ts', code: 'M.' },
          { path: 'b.ts', code: '??' },
        ])}
        {...makeHandlers()}
        onSelectPatch={onSelectPatch}
        onOpenAnnotate={onOpenAnnotate}
      />,
    );
    fireEvent.click(screen.getByTestId('annotate-staged-a.ts'));
    expect(onOpenAnnotate).toHaveBeenCalledWith('a.ts');
    fireEvent.click(screen.getByTestId('annotate-untracked-b.ts'));
    expect(onOpenAnnotate).toHaveBeenCalledWith('b.ts');
    expect(onSelectPatch).not.toHaveBeenCalled();
  });

  it('行内「历史」：点击回调带路径；缺省不渲染', () => {
    const onOpenHistory = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'a.ts', code: '.M' }])}
        {...makeHandlers()}
        onOpenHistory={onOpenHistory}
      />,
    );
    fireEvent.click(screen.getByTestId('history-unstaged-a.ts'));
    expect(onOpenHistory).toHaveBeenCalledWith('a.ts');
    render(<StatusPage status={makeStatus([{ path: 'b.ts', code: '.M' }])} {...makeHandlers()} />);
    expect(screen.queryByTestId('history-unstaged-b.ts')).not.toBeInTheDocument();
  });

  it('组级「创建补丁」：未勾选禁用；勾选工作区文件 → Modal 输入名 → {name, paths, staged:false} 回调', async () => {
    const onCreatePatch = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'a.ts', code: '.M' }])}
        {...makeHandlers()}
        onCreatePatch={onCreatePatch}
      />,
    );
    const button = screen.getByTestId('create-patch-unstaged');
    expect(button).toBeDisabled();
    clickCheckbox('check-unstaged-a.ts');
    fireEvent.click(screen.getByTestId('create-patch-unstaged'));
    fireEvent.change(await screen.findByTestId('page-action-patch-input'), { target: { value: 'wip' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreatePatch).toHaveBeenCalledTimes(1);
    // 工作区模式省略 staged（缺省 false → git diff HEAD），与 PatchPanel 省略约定一致
    expect(onCreatePatch).toHaveBeenCalledWith({ name: 'wip', paths: ['a.ts'] });
  });

  it('组级「创建补丁」（已暂存组）：载荷 staged:true', async () => {
    const onCreatePatch = vi.fn();
    render(
      <StatusPage
        status={makeStatus([{ path: 'a.ts', code: 'M.' }])}
        {...makeHandlers()}
        onCreatePatch={onCreatePatch}
      />,
    );
    clickCheckbox('check-staged-a.ts');
    fireEvent.click(screen.getByTestId('create-patch-staged'));
    fireEvent.change(await screen.findByTestId('page-action-patch-input'), { target: { value: 'wip' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreatePatch).toHaveBeenCalledWith({ name: 'wip', paths: ['a.ts'], staged: true });
  });

  it('页头「搁置」：Modal 输入名（必填，空禁用）→ 以 { name } 调 onShelve', async () => {
    const onShelve = vi.fn();
    render(<StatusPage status={makeStatus([])} {...makeHandlers()} onShelve={onShelve} />);
    fireEvent.click(screen.getByTestId('action-shelve'));
    const input = await screen.findByTestId('page-action-shelf-input');
    // 空名禁用
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'wip-1' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onShelve).toHaveBeenCalledTimes(1);
    expect(onShelve).toHaveBeenCalledWith('wip-1');
  });

  it('页头「存入贮藏」：message 可空（空白提交 undefined 语义）→ onStash 回调', async () => {
    const onStash = vi.fn();
    render(<StatusPage status={makeStatus([{ path: 'a.ts', code: '.M' }])} {...makeHandlers()} onStash={onStash} />);
    fireEvent.click(screen.getByTestId('action-stash'));
    fireEvent.change(await screen.findByTestId('page-action-stash-input'), { target: { value: '保存点' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onStash).toHaveBeenCalledWith('保存点');
    // 再开一次：不输入直接确定 → undefined（省略 message）
    fireEvent.click(screen.getByTestId('action-stash'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onStash).toHaveBeenCalledWith(undefined);
  });

  it('未传 onCreatePatch/onShelve/onStash 时对应按钮不渲染', () => {
    render(<StatusPage status={makeStatus([{ path: 'a.ts', code: '.M' }])} {...makeHandlers()} />);
    expect(screen.queryByTestId('create-patch-unstaged')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-shelve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-stash')).not.toBeInTheDocument();
  });
});
