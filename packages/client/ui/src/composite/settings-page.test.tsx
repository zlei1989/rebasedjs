import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_KEYS, type GitConfigView, type SettingsState } from '@rebased/contracts';
import { SettingsPage } from './settings-page';

/** 测试设置工厂：补全 SettingsState 必填字段 */
function makeSettings(): SettingsState {
  return { logInEditor: true, recentRepoIds: [] };
}

/** 测试配置视图工厂：user.name 有 local 覆盖，user.email 仅全局生效值，其余键未设置 */
function makeConfig(): GitConfigView {
  return {
    entries: CONFIG_KEYS.map((key) => {
      if (key === 'user.name') return { key, value: '旧名', localValue: '旧名' };
      if (key === 'user.email') return { key, value: 'a@b.c', localValue: null };
      return { key, value: null, localValue: null };
    }),
  };
}

describe('SettingsPage', () => {
  it('渲染"应用设置"与"Git 配置（仓库级）"两个卡片标题', () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
      />,
    );
    expect(screen.getByText('应用设置')).toBeInTheDocument();
    expect(screen.getByText('Git 配置（仓库级）')).toBeInTheDocument();
  });

  it('点击 Switch 后以 { logInEditor: false } 调 onPatchSettings 一次（初始 true）', () => {
    const onPatchSettings = vi.fn();
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={onPatchSettings}
        config={makeConfig()}
        onSetConfig={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onPatchSettings).toHaveBeenCalledTimes(1);
    expect(onPatchSettings).toHaveBeenCalledWith({ logInEditor: false });
  });

  it('settings 未就绪显示 Skeleton，不渲染 Switch', () => {
    render(<SettingsPage onPatchSettings={vi.fn()} config={makeConfig()} onSetConfig={vi.fn()} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('Git 配置行显示生效值；未设置键显示"未设置"', () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
      />,
    );
    expect(screen.getByText('user.name')).toBeInTheDocument();
    expect(screen.getByText('a@b.c')).toBeInTheDocument();
    // 6 个未设置键
    expect(screen.getAllByText('未设置')).toHaveLength(CONFIG_KEYS.length - 2);
  });

  it('输入新值点保存调 onSetConfig(key, value)', () => {
    const onSetConfig = vi.fn();
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={onSetConfig}
      />,
    );
    fireEvent.change(screen.getByTestId('config-input-user.name'), { target: { value: '新名' } });
    fireEvent.click(screen.getByTestId('config-save-user.name'));
    expect(onSetConfig).toHaveBeenCalledTimes(1);
    expect(onSetConfig).toHaveBeenCalledWith('user.name', '新名');
  });

  it('输入为空或与 localValue 相同时保存按钮禁用', () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
      />,
    );
    const input = screen.getByTestId('config-input-user.name');
    const save = screen.getByTestId('config-save-user.name');
    // 初始等于 localValue → 禁用
    expect(save).toBeDisabled();
    // 清空 → 禁用
    fireEvent.change(input, { target: { value: '' } });
    expect(save).toBeDisabled();
    // 改为不同值 → 可点
    fireEvent.change(input, { target: { value: '新名' } });
    expect(save).not.toBeDisabled();
  });

  it('config 未就绪显示 Skeleton，不渲染配置行', () => {
    render(<SettingsPage settings={makeSettings()} onPatchSettings={vi.fn()} onSetConfig={vi.fn()} />);
    expect(screen.queryByTestId('config-input-user.name')).not.toBeInTheDocument();
  });
});
