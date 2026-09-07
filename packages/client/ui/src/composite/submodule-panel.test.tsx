/**
 * SubmodulePanel 测试：行渲染（name/path/url/branch/commitSha 短哈希——可选字段缺省省略）、
 * status 四徽标映射（uninitialized 橙「未初始化」/checked-out 绿「已检出」/
 * different-commit 红「提交漂移」/conflict 红「冲突」）、
 * 行内「更新」载荷 {name}、顶部「更新全部」recursive Checkbox 默认不勾 → {}（不带 recursive 键）、
 * 勾选后 → {recursive:true}、空态「无子模块」+「未检测到 .gitmodules」、acting 禁用、
 * 刷新按钮缺省不渲染。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubmoduleEntry, SubmoduleList } from '@rebased/contracts';
import { SubmodulePanel, type SubmodulePanelProps } from './submodule-panel';

const SUB_UNINIT: SubmoduleEntry = {
  name: 'libs',
  path: 'vendor/libs',
  url: 'https://github.com/acme/libs.git',
  status: 'uninitialized',
};
const SUB_OK: SubmoduleEntry = {
  name: 'zoo',
  path: 'vendor/zoo',
  url: 'https://github.com/acme/zoo.git',
  branch: 'main',
  status: 'checked-out',
  commitSha: 'd'.repeat(40),
};
const SUB_DRIFT: SubmoduleEntry = {
  name: 'ham',
  path: 'vendor/ham',
  url: 'https://github.com/acme/ham.git',
  branch: 'v2',
  status: 'different-commit',
  commitSha: 'e'.repeat(40),
};
const SUB_CONFLICT: SubmoduleEntry = {
  name: 'mix',
  path: 'vendor/mix',
  url: 'https://github.com/acme/mix.git',
  branch: 'dev',
  status: 'conflict',
  commitSha: 'f'.repeat(40),
};

const LIST: SubmoduleList = { submodules: [SUB_UNINIT, SUB_OK, SUB_DRIFT, SUB_CONFLICT] };

/** 全量 props 渲染：缺省值可被 overrides 覆盖；返回回调替身便于断言 */
function renderPanel(overrides: Partial<SubmodulePanelProps> = {}) {
  const callbacks = {
    onUpdate: vi.fn(),
    onRefresh: vi.fn(),
  };
  const props: SubmodulePanelProps = {
    submodules: LIST,
    ...callbacks,
    ...overrides,
  };
  const view = render(<SubmodulePanel {...props} />);
  return { props, callbacks, view };
}

describe('SubmodulePanel 列表', () => {
  it('行渲染 name/path/url；branch 与 commitSha 可选，缺省省略（未初始化行无两者）', () => {
    renderPanel();
    const uninit = screen.getByTestId('submodule-row-libs');
    expect(uninit).toHaveTextContent('libs');
    expect(uninit).toHaveTextContent('vendor/libs');
    expect(uninit).toHaveTextContent('https://github.com/acme/libs.git');
    expect(uninit).not.toHaveTextContent('main');

    const ok = screen.getByTestId('submodule-row-zoo');
    expect(ok).toHaveTextContent('main');
    expect(ok).toHaveTextContent('ddddddd');
  });

  it('status 四徽标：uninitialized 橙 / checked-out 绿 / different-commit 红 / conflict 红', () => {
    renderPanel();
    expect(within(screen.getByTestId('submodule-row-libs')).getByText('未初始化')).toHaveClass('ant-tag-orange');
    expect(within(screen.getByTestId('submodule-row-zoo')).getByText('已检出')).toHaveClass('ant-tag-green');
    expect(within(screen.getByTestId('submodule-row-ham')).getByText('提交漂移')).toHaveClass('ant-tag-error');
    expect(within(screen.getByTestId('submodule-row-mix')).getByText('冲突')).toHaveClass('ant-tag-error');
  });
});

describe('SubmodulePanel 行内更新', () => {
  it('行内「更新」以 {name} 调 onUpdate（不带 recursive 键）', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('submodule-update-libs'));
    expect(callbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(callbacks.onUpdate).toHaveBeenCalledWith({ name: 'libs' });
    expect(callbacks.onUpdate.mock.calls[0][0]).not.toHaveProperty('recursive');
  });
});

describe('SubmodulePanel 更新全部', () => {
  it('recursive Checkbox 默认不勾；「更新全部」调 onUpdate({}) 且不带 recursive 键', () => {
    const { callbacks } = renderPanel();
    const checkbox = screen.getByRole('checkbox', { name: /递归/ });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByTestId('submodule-update-all'));
    expect(callbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(callbacks.onUpdate).toHaveBeenCalledWith({});
    expect(callbacks.onUpdate.mock.calls[0][0]).not.toHaveProperty('recursive');
  });

  it('勾选 recursive 后「更新全部」调 onUpdate({recursive:true})', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: /递归/ }));
    fireEvent.click(screen.getByTestId('submodule-update-all'));
    expect(callbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(callbacks.onUpdate).toHaveBeenCalledWith({ recursive: true });
  });
});

describe('SubmodulePanel 空态与 acting', () => {
  it('无子模块渲染「无子模块」并说明未检测到 .gitmodules', () => {
    renderPanel({ submodules: { submodules: [] } });
    expect(screen.getByText('无子模块')).toBeInTheDocument();
    expect(screen.getByText('未检测到 .gitmodules')).toBeInTheDocument();
  });

  it('acting 时更新全部/递归勾选/行内更新/刷新全部禁用', () => {
    renderPanel({ acting: true });
    expect(screen.getByTestId('submodule-update-all')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /递归/ })).toBeDisabled();
    expect(screen.getByTestId('submodule-update-libs')).toBeDisabled();
    expect(screen.getByTestId('submodule-refresh')).toBeDisabled();
  });

  it('点击「刷新」调 onRefresh', () => {
    const { callbacks } = renderPanel();
    fireEvent.click(screen.getByTestId('submodule-refresh'));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('onRefresh 缺省时不渲染刷新按钮', () => {
    renderPanel({ onRefresh: undefined });
    expect(screen.queryByTestId('submodule-refresh')).not.toBeInTheDocument();
  });
});
