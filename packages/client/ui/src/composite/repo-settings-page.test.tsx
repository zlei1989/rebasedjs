import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_KEYS, type GitConfigView } from '@rebased/contracts';
import { RepoSettingsPage } from './settings-page';

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

/** 渲染仓库设置页：默认给全 onBack/onOpenOtherSettings（导航另有专测） */
function renderRepoPage(props: Partial<React.ComponentProps<typeof RepoSettingsPage>> = {}): ReturnType<typeof render> {
  return render(
    <RepoSettingsPage
      config={makeConfig()}
      onSetConfig={vi.fn()}
      onBack={vi.fn()}
      onOpenOtherSettings={vi.fn()}
      {...props}
    />,
  );
}

describe('RepoSettingsPage 仓库级 git 配置', () => {
  it('渲染「Git 配置（仓库级）」卡片标题；不渲染应用级卡片', () => {
    renderRepoPage();
    expect(screen.getByText('Git 配置（仓库级）')).toBeInTheDocument();
    // 作用域隔离：应用级卡片（应用设置/保护分支/账户/Git 可执行文件）都不在仓库设置页
    expect(screen.queryByTestId('app-settings-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('protected-branches-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('accounts-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('git-executable-card')).not.toBeInTheDocument();
  });

  it('Git 配置行显示生效值；未设置键显示"未设置"', () => {
    renderRepoPage();
    expect(screen.getByText('user.name')).toBeInTheDocument();
    expect(screen.getByText('a@b.c')).toBeInTheDocument();
    // 6 个未设置键
    expect(screen.getAllByText('未设置')).toHaveLength(CONFIG_KEYS.length - 2);
  });

  it('输入新值点保存调 onSetConfig(key, value)', () => {
    const onSetConfig = vi.fn();
    renderRepoPage({ onSetConfig });
    fireEvent.change(screen.getByTestId('config-input-user.name'), { target: { value: '新名' } });
    fireEvent.click(screen.getByTestId('config-save-user.name'));
    expect(onSetConfig).toHaveBeenCalledTimes(1);
    expect(onSetConfig).toHaveBeenCalledWith('user.name', '新名');
  });

  it('输入为空或与 localValue 相同时保存按钮禁用', () => {
    renderRepoPage();
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
    renderRepoPage({ config: undefined });
    expect(screen.queryByTestId('config-input-user.name')).not.toBeInTheDocument();
  });

  it('互跳：点「应用设置」调 onOpenOtherSettings；点「返回日志」调 onBack；两者同一行、竖线分隔', () => {
    const onBack = vi.fn();
    const onOpenOtherSettings = vi.fn();
    const { container } = renderRepoPage({ onBack, onOpenOtherSettings });
    // 导航条形态：Space + 竖直 Divider（两链接同行，中间一条竖线）
    expect(container.querySelector('.ant-divider-vertical')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('app-settings-link'));
    expect(onOpenOtherSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '返回日志' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('RepoSettingsPage GPG 提交签名（GitGpgConfigDialog 语义）', () => {
  const VIEW_DISABLED = {
    enabled: false,
    key: null,
    keys: [{ id: 'A'.repeat(16), description: 'Test User <test@example.com>' }],
  };
  const VIEW_ENABLED = { enabled: true, key: 'A'.repeat(16), keys: VIEW_DISABLED.keys };

  it('未启用 → 「未启用」徽标 + 配置按钮；已启用 → 「已启用」+ 密钥及描述', () => {
    const { rerender } = renderRepoPage({ gpgConfig: VIEW_DISABLED, onSetGpgConfig: vi.fn() });
    expect(screen.getByText('GPG 提交签名')).toBeInTheDocument();
    expect(screen.getByTestId('gpg-disabled-tag')).toBeInTheDocument();
    expect(screen.getByTestId('gpg-configure-button')).toBeInTheDocument();

    rerender(
      <RepoSettingsPage
        config={makeConfig()}
        onSetConfig={vi.fn()}
        onBack={vi.fn()}
        gpgConfig={VIEW_ENABLED}
        onSetGpgConfig={vi.fn()}
      />,
    );
    expect(screen.getByTestId('gpg-enabled-tag')).toBeInTheDocument();
    expect(screen.getByText('A'.repeat(16))).toBeInTheDocument();
    expect(screen.getByText('Test User <test@example.com>')).toBeInTheDocument();
  });

  it('未传 gpgConfig 时不渲染 GPG 卡片', () => {
    renderRepoPage();
    expect(screen.queryByText('GPG 提交签名')).not.toBeInTheDocument();
  });

  it('配置 Modal：取消勾选 → 提交 { enabled:false, key:null }；勾选无密钥 → 确定禁用', async () => {
    const onSetGpgConfig = vi.fn();
    renderRepoPage({ gpgConfig: VIEW_ENABLED, onSetGpgConfig });
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
    renderRepoPage({ gpgConfig: VIEW_DISABLED, onSetGpgConfig });
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
    renderRepoPage({ gpgConfig: { enabled: false, key: null, keys: [] }, onSetGpgConfig: vi.fn() });
    fireEvent.click(screen.getByTestId('gpg-configure-button'));
    expect(await screen.findByTestId('gpg-no-keys')).toHaveTextContent('未找到可用的 gpg 密钥');
    expect(screen.getByRole('checkbox', { name: /为仓库提交签名/ })).toBeDisabled();
  });
});
