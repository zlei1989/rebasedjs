import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RepoInfo } from '@rebased/contracts';
import { RepoPage } from './repo-page';

/** 测试仓库工厂：补全 RepoInfo 必填字段，按需覆盖 */
function makeRepo(overrides: Partial<RepoInfo> & { id: string }): RepoInfo {
  return {
    path: `/home/user/${overrides.id}`,
    name: overrides.id,
    openedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

const HOME = '/home/user';

describe('RepoPage', () => {
  it('渲染最近仓库列表：显示名 + ~/… 路径副文本', () => {
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha', path: '/home/user/alpha' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
      />,
    );
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('~/alpha')).toBeInTheDocument();
  });

  it('主目录外路径副文本原样显示', () => {
    render(
      <RepoPage repos={[makeRepo({ id: 'b', name: 'beta', path: '/opt/beta' })]} onOpen={vi.fn()} homeDir={HOME} />,
    );
    expect(screen.getByText('/opt/beta')).toBeInTheDocument();
  });

  it('最近优先排序（openedAt 降序）', () => {
    render(
      <RepoPage
        repos={[
          makeRepo({ id: 'old', name: '旧仓库', openedAt: '2026-08-01T10:00:00.000Z' }),
          makeRepo({ id: 'new', name: '新仓库', openedAt: '2026-09-01T10:00:00.000Z' }),
        ]}
        onOpen={vi.fn()}
        homeDir={HOME}
      />,
    );
    const items = screen.getAllByTestId('repo-item');
    expect(within(items[0]).getByText('新仓库')).toBeInTheDocument();
    expect(within(items[1]).getByText('旧仓库')).toBeInTheDocument();
  });

  it('同路径去重，保留最近一条', () => {
    render(
      <RepoPage
        repos={[
          makeRepo({ id: 'first', name: '旧注册', path: '/home/user/dup', openedAt: '2026-08-01T10:00:00.000Z' }),
          makeRepo({ id: 'second', name: '新注册', path: '/home/user/dup', openedAt: '2026-09-01T10:00:00.000Z' }),
        ]}
        onOpen={vi.fn()}
        homeDir={HOME}
      />,
    );
    const items = screen.getAllByTestId('repo-item');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('新注册')).toBeInTheDocument();
  });

  it('列表上限 50 条', () => {
    const repos = Array.from({ length: 55 }, (_, i) =>
      makeRepo({ id: `r${i}`, openedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }),
    );
    render(<RepoPage repos={repos} onOpen={vi.fn()} homeDir={HOME} />);
    expect(screen.getAllByTestId('repo-item')).toHaveLength(50);
  });

  it('未传 onRemove 时不渲染移除按钮（回调缺省语义：容器未接线则无死控件）', () => {
    render(<RepoPage repos={[makeRepo({ id: 'a', name: 'alpha' })]} onOpen={vi.fn()} homeDir={HOME} />);
    expect(screen.queryByTestId('repo-remove')).not.toBeInTheDocument();
  });

  it('点击移除弹确认，确认后回调 onRemove(repoId)', async () => {
    const onRemove = vi.fn();
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha' })]}
        onOpen={vi.fn()}
        onRemove={onRemove}
        homeDir={HOME}
      />,
    );
    fireEvent.click(screen.getByTestId('repo-remove'));
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('打开表单提交回调 onOpen(path)', () => {
    const onOpen = vi.fn();
    render(<RepoPage repos={[]} onOpen={onOpen} homeDir={HOME} />);
    fireEvent.change(screen.getByPlaceholderText('仓库路径'), { target: { value: '/home/user/new-repo' } });
    // antd Button 两个汉字间自动插空格（"打 开"），用正则匹配可访问名
    fireEvent.click(screen.getByRole('button', { name: /打\s*开/ }));
    expect(onOpen).toHaveBeenCalledWith('/home/user/new-repo');
  });

  it('空列表渲染空态', () => {
    render(<RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} />);
    expect(screen.getByText('暂无最近仓库')).toBeInTheDocument();
  });
});

describe('RepoPage 克隆/初始化入口', () => {
  it('未传 onClone/onInit 时不渲染对应按钮', () => {
    render(<RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} />);
    expect(screen.queryByRole('button', { name: /克\s*隆/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /初\s*始\s*化/ })).not.toBeInTheDocument();
  });

  it('克隆 Modal：URL + 目录双必填，确定回调 onClone(url, dir)', async () => {
    const onClone = vi.fn();
    render(<RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} onClone={onClone} />);
    fireEvent.click(screen.getByRole('button', { name: /克\s*隆/ }));
    // 双必填：空表单确定按钮禁用
    const ok = await screen.findByRole('button', { name: /确\s*定/ });
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByTestId('clone-url'), { target: { value: 'https://example.com/a/b.git' } });
    fireEvent.change(screen.getByTestId('clone-dir'), { target: { value: 'D:\\work\\b' } });
    fireEvent.click(ok);
    expect(onClone).toHaveBeenCalledWith('https://example.com/a/b.git', 'D:\\work\\b');
  });

  it('初始化 Modal：路径必填，确定回调 onInit(path)', async () => {
    const onInit = vi.fn();
    render(<RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} onInit={onInit} />);
    fireEvent.click(screen.getByRole('button', { name: /初\s*始\s*化/ }));
    const ok = await screen.findByRole('button', { name: /确\s*定/ });
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByTestId('init-path'), { target: { value: '/tmp/new-repo' } });
    fireEvent.click(ok);
    expect(onInit).toHaveBeenCalledWith('/tmp/new-repo');
  });
});

describe('RepoPage 点击列表项打开仓库（点击最近项目 → 日志页）', () => {
  it('点击列表行以该仓库调 onOpenRepo', () => {
    const onOpenRepo = vi.fn();
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha', path: '/home/user/alpha' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={onOpenRepo}
      />,
    );
    fireEvent.click(screen.getByTestId('repo-item'));
    expect(onOpenRepo).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', path: '/home/user/alpha' }));
  });

  it('点「移除」按钮不冒泡为打开（行内操作独立）', async () => {
    const onOpenRepo = vi.fn();
    const onRemove = vi.fn();
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={onOpenRepo}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByTestId('repo-remove'));
    // 确认气泡在 body portal：点它同样不得触发打开
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onRemove).toHaveBeenCalledWith('a');
    expect(onOpenRepo).not.toHaveBeenCalled();
  });

  it('openingRepoId 命中的行显示「打开中」加载态，其余行不显示', () => {
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha' }), makeRepo({ id: 'b', name: 'beta' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={vi.fn()}
        openingRepoId="a"
      />,
    );
    const rows = screen.getAllByTestId('repo-item');
    const alphaRow = rows.find((row) => within(row).queryByText('alpha') !== null);
    const betaRow = rows.find((row) => within(row).queryByText('beta') !== null);
    expect(within(alphaRow!).getByTestId('repo-opening')).toBeInTheDocument();
    expect(within(betaRow!).queryByTestId('repo-opening')).not.toBeInTheDocument();
  });

  it('打开中的行忽略再次点击（防连点重复触发打开流程）', () => {
    const onOpenRepo = vi.fn();
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={onOpenRepo}
        openingRepoId="a"
      />,
    );
    fireEvent.click(screen.getByTestId('repo-item'));
    expect(onOpenRepo).not.toHaveBeenCalled();
  });

  it('打开中的行禁用「移除」（打开往返内删掉该仓库会跳进拉不到 status 的白屏页）', () => {
    const onRemove = vi.fn();
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={vi.fn()}
        onRemove={onRemove}
        openingRepoId="a"
      />,
    );
    expect(screen.getByTestId('repo-remove')).toBeDisabled();
  });

  it('打开中点其它行仍可打开（openingRepoId 只锁命中行，允许改选）', () => {
    const onOpenRepo = vi.fn();
    render(
      <RepoPage
        repos={[makeRepo({ id: 'a', name: 'alpha' }), makeRepo({ id: 'b', name: 'beta' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={onOpenRepo}
        openingRepoId="a"
      />,
    );
    const betaRow = screen.getAllByTestId('repo-item').find((row) => within(row).queryByText('beta') !== null);
    fireEvent.click(betaRow!);
    expect(onOpenRepo).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('未注入 onOpenRepo 时行不可点：光标保持默认、点击不误触发打开表单', () => {
    const onOpen = vi.fn();
    render(<RepoPage repos={[makeRepo({ id: 'a', name: 'alpha' })]} onOpen={onOpen} homeDir={HOME} />);
    const row = screen.getByTestId('repo-item');
    expect(row).not.toHaveStyle({ cursor: 'pointer' });
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('RepoPage 设置入口（欢迎屏 Configure → SettingsPage 语义 #3）', () => {
  it('有最近仓库：点击以最近仓库 id 调 onOpenSettings（打开时间降序优先）', () => {
    const onOpenSettings = vi.fn();
    render(
      <RepoPage
        repos={[
          makeRepo({ id: 'older', openedAt: '2026-08-01T10:00:00.000Z' }),
          makeRepo({ id: 'newer', openedAt: '2026-09-01T10:00:00.000Z' }),
        ]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByTestId('open-settings-button'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('newer');
  });

  it('无最近仓库：按钮禁用；未注入回调：按钮不渲染', () => {
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} onOpenSettings={onOpenSettings} />,
    );
    expect(screen.getByTestId('open-settings-button')).toBeDisabled();
    rerender(<RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} />);
    expect(screen.queryByTestId('open-settings-button')).not.toBeInTheDocument();
  });
});
