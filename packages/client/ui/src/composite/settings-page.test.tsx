import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_KEYS, type AccountList, type GitConfigView, type SettingsState } from '@rebased/contracts';
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

/** 测试账户列表工厂：两条掩码账户（token 本体不下行，仅有 tokenPreview） */
function makeAccounts(): AccountList {
  return {
    accounts: [
      { host: 'github.com', account: 'alice', tokenPreview: 'abcd***' },
      { host: 'gitlab.example.com', account: 'bob', tokenPreview: 'efgh***' },
    ],
  };
}

describe('SettingsPage 账户卡片', () => {
  it('缺省账户 props 时不渲染「账户」卡片（向后兼容）', () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
      />,
    );
    expect(screen.queryByText('账户')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-account-button')).not.toBeInTheDocument();
  });

  it('渲染账户行：host + account + tokenPreview + 删除按钮', () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        accounts={makeAccounts()}
        onAddAccount={vi.fn()}
        onDeleteAccount={vi.fn()}
      />,
    );
    expect(screen.getByText('账户')).toBeInTheDocument();
    expect(screen.getByText('github.com')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('abcd***')).toBeInTheDocument();
    expect(screen.getByText('gitlab.example.com')).toBeInTheDocument();
    expect(screen.getByText('efgh***')).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-github.com-alice')).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-gitlab.example.com-bob')).toBeInTheDocument();
  });

  it('账户列表为空时显示空提示', () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        onSetConfig={vi.fn()}
        accounts={{ accounts: [] }}
        onAddAccount={vi.fn()}
        onDeleteAccount={vi.fn()}
      />,
    );
    expect(screen.getByText('暂无账户')).toBeInTheDocument();
  });

  it('添加 Modal：任一字段为空时确定禁用；三字段齐后提交 {host, account, token}', async () => {
    const onAddAccount = vi.fn();
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        onSetConfig={vi.fn()}
        accounts={makeAccounts()}
        onAddAccount={onAddAccount}
        onDeleteAccount={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('add-account-button'));
    const hostInput = await screen.findByTestId('account-host-input');
    const nameInput = screen.getByTestId('account-name-input');
    const tokenInput = screen.getByTestId('account-token-input');
    const ok = screen.getByTestId('add-account-submit');
    expect(ok).toBeDisabled();
    fireEvent.change(hostInput, { target: { value: 'gitee.com' } });
    fireEvent.change(nameInput, { target: { value: 'carol' } });
    expect(ok).toBeDisabled();
    fireEvent.change(tokenInput, { target: { value: 'secret-token' } });
    expect(ok).not.toBeDisabled();
    fireEvent.click(ok);
    expect(onAddAccount).toHaveBeenCalledTimes(1);
    expect(onAddAccount).toHaveBeenCalledWith({
      host: 'gitee.com',
      account: 'carol',
      token: 'secret-token',
    });
  });

  it('添加 Modal 取消后重开：输入复位不残留', async () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        onSetConfig={vi.fn()}
        accounts={makeAccounts()}
        onAddAccount={vi.fn()}
        onDeleteAccount={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('add-account-button'));
    fireEvent.change(await screen.findByTestId('account-host-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(screen.getByTestId('add-account-button'));
    const hostInput = await screen.findByTestId('account-host-input');
    expect(hostInput).toHaveValue('');
  });

  it('删除经 Popconfirm 确认后以 {host, account} 调 onDeleteAccount', async () => {
    const onDeleteAccount = vi.fn();
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        onSetConfig={vi.fn()}
        accounts={makeAccounts()}
        onAddAccount={vi.fn()}
        onDeleteAccount={onDeleteAccount}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-account-github.com-alice'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    expect(onDeleteAccount).toHaveBeenCalledWith({ host: 'github.com', account: 'alice' });
  });

  it('git 可执行文件：ok 渲染检测徽标与版本；未检出渲染引导；缺省不渲染卡片', () => {
    const { rerender } = render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gitExecutable={{ exec: 'git', version: 'git version 2.47.0', ok: true }}
      />,
    );
    expect(screen.getByText('Git 可执行文件')).toBeInTheDocument();
    expect(screen.getByTestId('git-executable-ok')).toBeInTheDocument();
    expect(screen.getByTestId('git-executable-version')).toHaveTextContent('git version 2.47.0');

    rerender(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gitExecutable={{ exec: 'git', version: null, ok: false }}
      />,
    );
    expect(screen.getByTestId('git-executable-error')).toHaveTextContent('未检测到可用的 git 可执行文件');

    rerender(
      <SettingsPage settings={makeSettings()} onPatchSettings={vi.fn()} config={makeConfig()} onSetConfig={vi.fn()} />,
    );
    expect(screen.queryByText('Git 可执行文件')).not.toBeInTheDocument();
  });
});

describe('SettingsPage GPG 提交签名（GitGpgConfigDialog 语义）', () => {
  const VIEW_DISABLED = {
    enabled: false,
    key: null,
    keys: [{ id: 'A'.repeat(16), description: 'Test User <test@example.com>' }],
  };
  const VIEW_ENABLED = { enabled: true, key: 'A'.repeat(16), keys: VIEW_DISABLED.keys };

  it('未启用 → 「未启用」徽标 + 配置按钮；已启用 → 「已启用」+ 密钥及描述', () => {
    const { rerender } = render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gpgConfig={VIEW_DISABLED}
        onSetGpgConfig={vi.fn()}
      />,
    );
    expect(screen.getByText('GPG 提交签名')).toBeInTheDocument();
    expect(screen.getByTestId('gpg-disabled-tag')).toBeInTheDocument();
    expect(screen.getByTestId('gpg-configure-button')).toBeInTheDocument();

    rerender(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gpgConfig={VIEW_ENABLED}
        onSetGpgConfig={vi.fn()}
      />,
    );
    expect(screen.getByTestId('gpg-enabled-tag')).toBeInTheDocument();
    expect(screen.getByText('A'.repeat(16))).toBeInTheDocument();
    expect(screen.getByText('Test User <test@example.com>')).toBeInTheDocument();
  });

  it('未传 gpgConfig 时不渲染 GPG 卡片（向后兼容）', () => {
    render(<SettingsPage settings={makeSettings()} onPatchSettings={vi.fn()} config={makeConfig()} onSetConfig={vi.fn()} />);
    expect(screen.queryByText('GPG 提交签名')).not.toBeInTheDocument();
  });

  it('配置 Modal：取消勾选 → 提交 { enabled:false, key:null }；勾选无密钥 → 确定禁用', async () => {
    const onSetGpgConfig = vi.fn();
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gpgConfig={VIEW_ENABLED}
        onSetGpgConfig={onSetGpgConfig}
      />,
    );
    fireEvent.click(screen.getByTestId('gpg-configure-button'));
    const checkbox = await screen.findByRole('checkbox', { name: /为仓库提交签名/ });
    expect(checkbox).toBeChecked();
    // 取消勾选 → key 不可选 → 提交 { enabled:false, key:null }（服务端仅写 commit.gpgsign=false）
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onSetGpgConfig).toHaveBeenCalledTimes(1);
    expect(onSetGpgConfig).toHaveBeenCalledWith({ enabled: false, key: null });
  });

  it('配置 Modal：勾选启用 + 选择密钥 → 提交 { enabled:true, key }', async () => {
    const onSetGpgConfig = vi.fn();
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gpgConfig={VIEW_DISABLED}
        onSetGpgConfig={onSetGpgConfig}
      />,
    );
    fireEvent.click(screen.getByTestId('gpg-configure-button'));
    const checkbox = await screen.findByRole('checkbox', { name: /为仓库提交签名/ });
    expect(checkbox).not.toBeChecked();
    // 未勾选时确定可用且提交 key:null（关闭签名）；勾选后需选密钥
    fireEvent.click(checkbox);
    expect(screen.getByTestId('gpg-config-submit')).toBeDisabled();
    fireEvent.mouseDown(screen.getByTestId('gpg-key-select'));
    fireEvent.click(await screen.findByText(/A{16}（Test User <test@example.com>）/));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onSetGpgConfig).toHaveBeenCalledTimes(1);
    expect(onSetGpgConfig).toHaveBeenCalledWith({ enabled: true, key: 'A'.repeat(16) });
  });

  it('无可用密钥：Alert 提示且启用勾选禁用', async () => {
    render(
      <SettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        config={makeConfig()}
        onSetConfig={vi.fn()}
        gpgConfig={{ enabled: false, key: null, keys: [] }}
        onSetGpgConfig={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('gpg-configure-button'));
    expect(await screen.findByTestId('gpg-no-keys')).toHaveTextContent('未找到可用的 gpg 密钥');
    expect(screen.getByRole('checkbox', { name: /为仓库提交签名/ })).toBeDisabled();
  });
});
