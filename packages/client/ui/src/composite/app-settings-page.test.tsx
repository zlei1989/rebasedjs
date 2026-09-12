import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountList, SettingsState } from '@rebased/contracts';
import { AppSettingsPage } from './settings-page';

/** 测试设置工厂：补全 SettingsState 必填字段 */
function makeSettings(): SettingsState {
  return { logInEditor: true, recentRepoIds: [], protectedBranchPatterns: [], theme: 'dark' };
}

/** 测试账户列表工厂：两条掩码账户（token 本体不下行，仅有 tokenPreview） */
function makeAccounts(): AccountList {
  return {
    accounts: [
      { host: 'github.com', account: 'alice', tokenPreview: 'abcd***' },
      { host: 'gitlab.example.com', account: 'bob', tokenPreview: 'efgh***' },
    ],
  };
}

/** 渲染应用设置页：默认给全 onBack/onOpenOtherSettings（导航另有专测） */
function renderAppPage(props: Partial<React.ComponentProps<typeof AppSettingsPage>> = {}): ReturnType<typeof render> {
  return render(
    <AppSettingsPage settings={makeSettings()} onPatchSettings={vi.fn()} onBack={vi.fn()} onOpenOtherSettings={vi.fn()} {...props} />,
  );
}

describe('AppSettingsPage 应用级设置', () => {
  it('渲染应用级卡片；不渲染仓库级卡片（作用域隔离）', () => {
    renderAppPage({
      accounts: makeAccounts(),
      onAddAccount: vi.fn(),
      onDeleteAccount: vi.fn(),
      gitExecutable: { exec: 'git', version: 'git version 2.47.0', ok: true },
    });
    expect(screen.getByTestId('app-settings-card')).toBeInTheDocument();
    expect(screen.getByTestId('protected-branches-card')).toBeInTheDocument();
    expect(screen.getByTestId('git-executable-card')).toBeInTheDocument();
    expect(screen.getByTestId('accounts-card')).toBeInTheDocument();
    // 仓库级项不在这里：git 配置行与 GPG 卡片都归属仓库设置页
    expect(screen.queryByText('Git 配置（仓库级）')).not.toBeInTheDocument();
    expect(screen.queryByTestId('config-input-user.name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gpg-card')).not.toBeInTheDocument();
  });

  it('点击 Switch 后以 { logInEditor: false } 调 onPatchSettings 一次（初始 true）', () => {
    const onPatchSettings = vi.fn();
    renderAppPage({ onPatchSettings });
    fireEvent.click(screen.getByRole('switch'));
    expect(onPatchSettings).toHaveBeenCalledTimes(1);
    expect(onPatchSettings).toHaveBeenCalledWith({ logInEditor: false });
  });

  it('settings 未就绪显示 Skeleton，不渲染 Switch', () => {
    renderAppPage({ settings: undefined });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('界面主题三选（自动/明亮/暗色）：点「自动」以 { theme: "auto" } 调 onPatchSettings', () => {
    const onPatchSettings = vi.fn();
    renderAppPage({ onPatchSettings });
    // 三选项都在（顺序：自动 / 明亮 / 暗色）
    expect(screen.getByText('自动')).toBeInTheDocument();
    expect(screen.getByText('明亮')).toBeInTheDocument();
    expect(screen.getByText('暗色')).toBeInTheDocument();
    fireEvent.click(screen.getByText('自动'));
    expect(onPatchSettings).toHaveBeenCalledTimes(1);
    expect(onPatchSettings).toHaveBeenCalledWith({ theme: 'auto' });
  });

  it('界面主题三选：点「明亮」以 { theme: "light" } 调 onPatchSettings', () => {
    const onPatchSettings = vi.fn();
    renderAppPage({ settings: { ...makeSettings(), theme: 'auto' }, onPatchSettings });
    fireEvent.click(screen.getByText('明亮'));
    expect(onPatchSettings).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('互跳：点「仓库设置」调 onOpenOtherSettings；点「返回首页」调 onBack；两者同一行、竖线分隔', () => {
    const onBack = vi.fn();
    const onOpenOtherSettings = vi.fn();
    const { container } = renderAppPage({ onBack, onOpenOtherSettings });
    // 导航条形态：Space + 竖直 Divider（两链接同行，中间一条竖线）
    expect(container.querySelector('.ant-divider-vertical')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('repo-settings-link'));
    expect(onOpenOtherSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AppSettingsPage 账户卡片', () => {
  it('缺省账户 props 时不渲染「账户」卡片（向后兼容）', () => {
    renderAppPage();
    expect(screen.queryByText('账户')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-account-button')).not.toBeInTheDocument();
  });

  it('渲染账户行：host + account + tokenPreview + 删除按钮', () => {
    renderAppPage({ accounts: makeAccounts(), onAddAccount: vi.fn(), onDeleteAccount: vi.fn() });
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
    renderAppPage({ accounts: { accounts: [] }, onAddAccount: vi.fn(), onDeleteAccount: vi.fn() });
    expect(screen.getByText('暂无账户')).toBeInTheDocument();
  });

  it('添加 Modal：任一字段为空时确定禁用；三字段齐后提交 {host, account, token}', async () => {
    const onAddAccount = vi.fn();
    renderAppPage({ accounts: makeAccounts(), onAddAccount, onDeleteAccount: vi.fn() });
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
    renderAppPage({ accounts: makeAccounts(), onAddAccount: vi.fn(), onDeleteAccount: vi.fn() });
    fireEvent.click(screen.getByTestId('add-account-button'));
    fireEvent.change(await screen.findByTestId('account-host-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(screen.getByTestId('add-account-button'));
    const hostInput = await screen.findByTestId('account-host-input');
    expect(hostInput).toHaveValue('');
  });

  it('删除经 Popconfirm 确认后以 {host, account} 调 onDeleteAccount', async () => {
    const onDeleteAccount = vi.fn();
    renderAppPage({ accounts: makeAccounts(), onAddAccount: vi.fn(), onDeleteAccount });
    fireEvent.click(screen.getByTestId('delete-account-github.com-alice'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    expect(onDeleteAccount).toHaveBeenCalledWith({ host: 'github.com', account: 'alice' });
  });

  it('git 可执行文件：ok 渲染检测徽标与版本；未检出渲染引导；缺省不渲染卡片', () => {
    const { rerender } = renderAppPage({ gitExecutable: { exec: 'git', version: 'git version 2.47.0', ok: true } });
    expect(screen.getByText('Git 可执行文件')).toBeInTheDocument();
    expect(screen.getByTestId('git-executable-ok')).toBeInTheDocument();
    expect(screen.getByTestId('git-executable-version')).toHaveTextContent('git version 2.47.0');

    rerender(
      <AppSettingsPage
        settings={makeSettings()}
        onPatchSettings={vi.fn()}
        onBack={vi.fn()}
        gitExecutable={{ exec: 'git', version: null, ok: false }}
      />,
    );
    expect(screen.getByTestId('git-executable-error')).toHaveTextContent('未检测到可用的 git 可执行文件');

    rerender(<AppSettingsPage settings={makeSettings()} onPatchSettings={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText('Git 可执行文件')).not.toBeInTheDocument();
  });
});

describe('AppSettingsPage 保护分支（GitVcsPanel.protectedBranchesRow 语义）', () => {
  it('输入多个模式（每行一个）→ 以 {protectedBranchPatterns} 调 onPatchSettings', () => {
    const onPatchSettings = vi.fn();
    renderAppPage({ onPatchSettings });
    fireEvent.change(screen.getByTestId('protected-patterns-input'), { target: { value: '^main$\n^release/' } });
    expect(screen.getByTestId('protected-patterns-save')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('protected-patterns-save'));
    expect(onPatchSettings).toHaveBeenCalledTimes(1);
    expect(onPatchSettings).toHaveBeenCalledWith({ protectedBranchPatterns: ['^main$', '^release/'] });
  });

  it('非法正则：标红错误并禁止保存（RegExp 编译校验）', () => {
    const onPatchSettings = vi.fn();
    renderAppPage({ onPatchSettings });
    fireEvent.change(screen.getByTestId('protected-patterns-input'), { target: { value: '^main$\n([' } });
    expect(screen.getByTestId('protected-patterns-error')).toHaveTextContent('非法正则：([');
    expect(screen.getByTestId('protected-patterns-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('protected-patterns-save'));
    expect(onPatchSettings).not.toHaveBeenCalled();
  });

  it('settings 未就绪时不渲染保护分支卡片（数据源自应用设置）', () => {
    renderAppPage({ settings: undefined });
    expect(screen.queryByTestId('protected-branches-card')).not.toBeInTheDocument();
  });
});
