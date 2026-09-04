/**
 * RebaseDialog 交互式变基对话框测试：
 *  简单模式（onto 空禁用 + 开始载荷 trim）/ 交互模式（行渲染短哈希+subject+默认 pick、
 *  上移/下移交换与首末行边界禁用、动作 Select 变更、全 drop 禁用确定、编辑后载荷顺序、
 *  关闭复位重开恢复初始、base 输入回调、todoLoading 加载态、数据源变化重建）。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TodoEntry } from '@rebased/contracts';
import { RebaseDialog } from './rebase-dialog';

/** 三提交数据源（顺序即重放顺序） */
const H1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const H2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const H3 = 'cccccccccccccccccccccccccccccccccccccccc';
const TODO: TodoEntry[] = [
  { hash: H1, subject: '提交一' },
  { hash: H2, subject: '提交二' },
  { hash: H3, subject: '提交三' },
];

/** 换 base 后的第二个数据源（两提交） */
const D1 = 'dddddddddddddddddddddddddddddddddddddddd';
const D2 = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TODO2: TodoEntry[] = [
  { hash: D1, subject: '其他一' },
  { hash: D2, subject: '其他二' },
];

/** 测试回调工厂 */
function makeHandlers() {
  return {
    onRebaseOnto: vi.fn(),
    onInteractiveRebase: vi.fn(),
    onCancel: vi.fn(),
    onBaseChange: vi.fn(),
  };
}

/** 切到交互模式（点「交互」radio） */
function switchToInteractive(): void {
  fireEvent.click(screen.getByRole('radio', { name: /交互/ }));
}

/** 打开一行动作下拉并按键盘选择目标动作：antd 下拉关闭后仍挂载 DOM，文本点击会命中已关闭下拉的同名
 *  选项；键盘路径经该行自身的 input（rc-select 按 event.which 处理），活动项按 aria-activedescendant 读回，
 *  不依赖下拉 DOM 的可见性（jsdom 无动画/布局）。 */
async function changeAction(hash: string, action: string): Promise<void> {
  const select = screen.getByTestId(`todo-action-${hash}`);
  fireEvent.mouseDown(select.querySelector('.ant-select-content')!);
  const input = select.querySelector('.ant-select-input') as HTMLInputElement;
  const readActive = (): string => {
    const id = input.getAttribute('aria-activedescendant');
    return (id ? document.getElementById(id)?.textContent?.trim() : undefined) ?? '';
  };
  for (let i = 0; i < 5 && readActive() !== action; i++) {
    fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 40 });
  }
  expect(readActive()).toBe(action);
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
  fireEvent.keyUp(input, { key: 'Enter', keyCode: 13 });
}

/** 当前 DOM 行顺序（按 data-testid 提取 hash）：验证交换结果 */
function rowOrder(): string[] {
  return screen
    .getAllByTestId(/^todo-row-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').slice('todo-row-'.length));
}

describe('RebaseDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<RebaseDialog open={false} {...makeHandlers()} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('默认简单模式：onto 为空时开始禁用，填写后传出 {onto: trimmed}', () => {
    const h = makeHandlers();
    render(<RebaseDialog open {...h} />);
    expect(screen.getByRole('radio', { name: /简单/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /开\s*始/ })).toBeDisabled();
    fireEvent.change(screen.getByTestId('rebase-onto'), { target: { value: '  main  ' } });
    fireEvent.click(screen.getByRole('button', { name: /开\s*始/ }));
    expect(h.onRebaseOnto).toHaveBeenCalledTimes(1);
    expect(h.onRebaseOnto).toHaveBeenCalledWith({ onto: 'main' });
  });

  it('交互模式渲染每行：短哈希 + subject + 默认动作 pick', () => {
    const h = makeHandlers();
    render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    const row = screen.getByTestId(`todo-row-${H1}`);
    expect(within(row).getByText(H1.slice(0, 8))).toBeInTheDocument();
    expect(within(row).getByText('提交一')).toBeInTheDocument();
    expect(within(row).getByText('pick')).toBeInTheDocument();
    expect(rowOrder()).toEqual([H1, H2, H3]);
  });

  it('上移/下移：首行禁上移、末行禁下移，与相邻行交换', () => {
    const h = makeHandlers();
    render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    expect(screen.getByTestId(`todo-up-${H1}`)).toBeDisabled();
    expect(screen.getByTestId(`todo-down-${H3}`)).toBeDisabled();
    expect(screen.getByTestId(`todo-up-${H2}`)).toBeEnabled();
    expect(screen.getByTestId(`todo-down-${H2}`)).toBeEnabled();
    // 禁用按钮点击无效（首行上移）
    fireEvent.click(screen.getByTestId(`todo-up-${H1}`));
    expect(rowOrder()).toEqual([H1, H2, H3]);
    // 下移第一行 → 与第二行交换
    fireEvent.click(screen.getByTestId(`todo-down-${H1}`));
    expect(rowOrder()).toEqual([H2, H1, H3]);
    // 上移末行 → 与上一行交换
    fireEvent.click(screen.getByTestId(`todo-up-${H3}`));
    expect(rowOrder()).toEqual([H2, H3, H1]);
    // 恢复原位后边界回归（末行回末、首行回首）
    fireEvent.click(screen.getByTestId(`todo-up-${H1}`));
    fireEvent.click(screen.getByTestId(`todo-up-${H1}`));
    expect(rowOrder()).toEqual([H1, H2, H3]);
    expect(screen.getByTestId(`todo-up-${H1}`)).toBeDisabled();
    expect(screen.getByTestId(`todo-down-${H3}`)).toBeDisabled();
  });

  it('动作 Select 变更后提交载荷携带新动作', async () => {
    const h = makeHandlers();
    render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    await changeAction(H2, 'reword');
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(h.onInteractiveRebase).toHaveBeenCalledWith({
      base: 'main',
      entries: [
        { hash: H1, action: 'pick' },
        { hash: H2, action: 'reword' },
        { hash: H3, action: 'pick' },
      ],
    });
  });

  it('全部行 drop 时确定禁用且不可提交', async () => {
    const h = makeHandlers();
    render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    await changeAction(H1, 'drop');
    await changeAction(H2, 'drop');
    await changeAction(H3, 'drop');
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(h.onInteractiveRebase).not.toHaveBeenCalled();
  });

  it('提交载荷为编辑后顺序（重排 + 动作混合）', async () => {
    const h = makeHandlers();
    render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    await changeAction(H1, 'drop');
    await changeAction(H3, 'squash');
    fireEvent.click(screen.getByTestId(`todo-down-${H1}`));
    expect(rowOrder()).toEqual([H2, H1, H3]);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(h.onInteractiveRebase).toHaveBeenCalledWith({
      base: 'main',
      entries: [
        { hash: H2, action: 'pick' },
        { hash: H1, action: 'drop' },
        { hash: H3, action: 'squash' },
      ],
    });
  });

  it('关闭复位：取消后重开恢复初始模式/输入/行序/动作', async () => {
    const h = makeHandlers();
    const { rerender } = render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    await changeAction(H1, 'drop');
    fireEvent.click(screen.getByTestId(`todo-down-${H1}`));
    expect(rowOrder()).toEqual([H2, H1, H3]);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    // 父级关窗后重开：内部状态全部回到基线（模式回简单、输入清空、行回初始）
    rerender(<RebaseDialog open={false} todo={TODO} base="main" {...h} />);
    rerender(<RebaseDialog open todo={TODO} base="main" {...h} />);
    expect(screen.getByRole('radio', { name: /简单/ })).toBeChecked();
    expect(screen.getByTestId('rebase-onto')).toHaveValue('');
    expect(screen.queryByTestId(`todo-row-${H1}`)).not.toBeInTheDocument();
    switchToInteractive();
    expect(rowOrder()).toEqual([H1, H2, H3]);
    expect(within(screen.getByTestId(`todo-row-${H1}`)).getByText('pick')).toBeInTheDocument();
  });

  it('交互模式基准输入变化回调 onBaseChange（base 由容器受控）', () => {
    const h = makeHandlers();
    render(<RebaseDialog open todo={TODO} base="" {...h} />);
    switchToInteractive();
    fireEvent.change(screen.getByTestId('rebase-base'), { target: { value: 'dev' } });
    expect(h.onBaseChange).toHaveBeenCalledWith('dev');
  });

  it('todoLoading 显示加载态；无 todo 行时确定禁用', () => {
    const h = makeHandlers();
    const { rerender } = render(<RebaseDialog open todoLoading base="main" {...h} />);
    switchToInteractive();
    expect(screen.getByTestId('rebase-todo-loading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
    rerender(<RebaseDialog open todo={[]} base="main" {...h} />);
    expect(screen.queryByTestId('rebase-todo-loading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('数据源变化（换 base 的新 todo）时行重建为默认 pick', async () => {
    const h = makeHandlers();
    const { rerender } = render(<RebaseDialog open todo={TODO} base="main" {...h} />);
    switchToInteractive();
    await changeAction(H1, 'drop');
    rerender(<RebaseDialog open todo={TODO2} base="dev" {...h} />);
    await waitFor(() => expect(rowOrder()).toEqual([D1, D2]));
    expect(within(screen.getByTestId(`todo-row-${D1}`)).getByText('pick')).toBeInTheDocument();
  });

  it('confirming 时确定按钮进入 loading 态', () => {
    const h = makeHandlers();
    render(<RebaseDialog open confirming {...h} />);
    expect(screen.getByRole('button', { name: /开\s*始/ })).toHaveClass('ant-btn-loading');
  });
});
