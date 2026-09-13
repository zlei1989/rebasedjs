import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecentRepoInfo, RepoInfo } from '@rebased/contracts';
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

/** 派生列表项工厂：在 makeRepo 之上补 branch/valid/colorIndex（服务端 GET /api/repos 的形状） */
function makeItem(
  overrides: Partial<RecentRepoInfo> & { id: string },
): RecentRepoInfo {
  return {
    path: `/home/user/${overrides.id}`,
    name: overrides.id,
    openedAt: '2026-09-01T10:00:00.000Z',
    branch: null,
    valid: true,
    colorIndex: 0,
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

describe('RepoPage 设置入口（欢迎屏 Configure 语义 #3）', () => {
  it('点击以无参回调打开应用设置（全局项，与最近仓库无关）', () => {
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
    // 应用设置与仓库无关：回调不带任何仓库参数
    expect(onOpenSettings.mock.calls[0]).toEqual([]);
  });

  it('无最近仓库：按钮仍可点（应用设置不依赖仓库）；未注入回调：按钮不渲染', () => {
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} onOpenSettings={onOpenSettings} />,
    );
    expect(screen.getByTestId('open-settings-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('open-settings-button'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    rerender(<RepoPage repos={[]} onOpen={vi.fn()} homeDir={HOME} />);
    expect(screen.queryByTestId('open-settings-button')).not.toBeInTheDocument();
  });
});

describe('RepoPage 列表项分支后缀 / 头像 / 失效标记', () => {
  it('有分支：显示名 = 名称 + 两个空格 + [分支]', () => {
    render(
      <RepoPage
        repos={[makeItem({ id: 'a', name: 'alpha', branch: 'main' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
      />,
    );
    expect(screen.getByTestId('repo-display-name').textContent).toBe('alpha  [main]');
  });

  it('无分支（detached/读不到）：显示名只有名称，无方括号', () => {
    render(
      <RepoPage repos={[makeItem({ id: 'b', name: 'beta', branch: null })]} onOpen={vi.fn()} homeDir={HOME} />,
    );
    expect(screen.getByTestId('repo-display-name').textContent).toBe('beta');
  });

  it('每行渲染首字母头像', () => {
    render(
      <RepoPage
        repos={[makeItem({ id: 'c', name: 'rebased-smoke', path: '/home/user/rebased-smoke' })]}
        onOpen={vi.fn()}
        homeDir={HOME}
      />,
    );
    expect(screen.getByTestId('repo-avatar')).toHaveTextContent('RS');
  });

  it('头像底色由服务端下发的 colorIndex 决定（换色号即换底色）', () => {
    const { rerender } = render(
      <RepoPage repos={[makeItem({ id: 'i', name: 'india', colorIndex: 1 })]} onOpen={vi.fn()} homeDir={HOME} />,
    );
    const withOne = screen.getByTestId('repo-avatar').getAttribute('style');

    rerender(<RepoPage repos={[makeItem({ id: 'i', name: 'india', colorIndex: 5 })]} onOpen={vi.fn()} homeDir={HOME} />);

    // 只比「随色号变化」，不比对具体 CSS 串——避免依赖 jsdom 对 background 简写的序列化口径
    expect(screen.getByTestId('repo-avatar').getAttribute('style')).not.toBe(withOne);
  });

  it('路径可用：不渲染失效标记、行不降不透明度', () => {
    render(
      <RepoPage repos={[makeItem({ id: 'd', name: 'delta', valid: true })]} onOpen={vi.fn()} homeDir={HOME} />,
    );
    expect(screen.queryByTestId('repo-invalid')).not.toBeInTheDocument();
    expect(screen.getByTestId('repo-item')).not.toHaveStyle({ opacity: '0.6' });
  });

  it('路径不可用：渲染失效标记且行降不透明度', () => {
    render(
      <RepoPage repos={[makeItem({ id: 'e', name: 'echo', valid: false })]} onOpen={vi.fn()} homeDir={HOME} />,
    );
    expect(screen.getByTestId('repo-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('repo-item')).toHaveStyle({ opacity: '0.6' });
  });

  it('点失效行不打开仓库，只弹确认（对齐 Java：弹窗后直接 return）', async () => {
    const onOpenRepo = vi.fn();
    render(
      <RepoPage
        repos={[makeItem({ id: 'f', name: 'foxtrot', path: '/home/user/gone', valid: false })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={onOpenRepo}
      />,
    );
    fireEvent.click(screen.getByTestId('repo-item'));
    expect(onOpenRepo).not.toHaveBeenCalled();
    expect(await screen.findByText('仓库路径不可用')).toBeInTheDocument();
    expect(screen.getByTestId('repo-invalid-path')).toHaveTextContent('~/gone (unavailable)');
    // 关闭后依然没有发生打开
    fireEvent.click(screen.getByTestId('repo-invalid-close'));
    expect(onOpenRepo).not.toHaveBeenCalled();
  });

  it('失效确认里「从最近列表移除」调 onRemove(repoId) 且不触发打开', async () => {
    const onOpenRepo = vi.fn();
    const onRemove = vi.fn();
    render(
      <RepoPage
        repos={[makeItem({ id: 'g', name: 'golf', valid: false })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={onOpenRepo}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByTestId('repo-item'));
    fireEvent.click(await screen.findByTestId('repo-invalid-remove'));
    expect(onRemove).toHaveBeenCalledWith('g');
    expect(onOpenRepo).not.toHaveBeenCalled();
  });

  it('未注入 onRemove：失效确认里不渲染「从最近列表移除」', async () => {
    render(
      <RepoPage
        repos={[makeItem({ id: 'h', name: 'hotel', valid: false })]}
        onOpen={vi.fn()}
        homeDir={HOME}
        onOpenRepo={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('repo-item'));
    expect(await screen.findByText('仓库路径不可用')).toBeInTheDocument();
    expect(screen.queryByTestId('repo-invalid-remove')).not.toBeInTheDocument();
  });
});
