import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteList } from '@rebased/contracts';
import { RemotePanel } from './remote-panel';

/** 测试远程列表工厂 */
function makeList(remotes: RemoteList['remotes']): RemoteList {
  return { remotes, shallow: false };
}

const REMOTES: RemoteList = makeList([
  { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
  { name: 'upstream', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
]);

/** 测试回调工厂 */
function makeHandlers() {
  return { onAction: vi.fn(), onFetch: vi.fn() };
}

describe('RemotePanel 列表渲染', () => {
  it('无远程时渲染 EmptyState', () => {
    render(<RemotePanel remotes={makeList([])} {...makeHandlers()} />);
    expect(screen.getByText('暂无远程')).toBeInTheDocument();
  });

  it('行渲染 name 与 fetchUrl', () => {
    render(<RemotePanel remotes={REMOTES} {...makeHandlers()} />);
    const row = screen.getByTestId('row-remote-origin');
    expect(row).toHaveTextContent('origin');
    expect(row).toHaveTextContent('https://example.com/a.git');
    expect(screen.getByTestId('row-remote-upstream')).toHaveTextContent('upstream');
  });

  it('shallow=true 渲染浅克隆徽标；false 不渲染', () => {
    const { unmount } = render(<RemotePanel remotes={{ remotes: REMOTES.remotes, shallow: true }} {...makeHandlers()} />);
    expect(screen.getByTestId('shallow-badge')).toHaveTextContent('浅克隆');
    unmount();
    render(<RemotePanel remotes={REMOTES} {...makeHandlers()} />);
    expect(screen.queryByTestId('shallow-badge')).not.toBeInTheDocument();
  });
});

describe('RemotePanel 添加远程', () => {
  it('name/url 任一为空时确定禁用', async () => {
    render(<RemotePanel remotes={makeList([])} {...makeHandlers()} />);
    fireEvent.click(screen.getByTestId('add-remote-button'));
    fireEvent.change(await screen.findByTestId('add-remote-name'), { target: { value: 'origin' } });
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('填写 name+url 后确定：以 {action:"add",name,url} 调 onAction', async () => {
    const { onAction } = makeHandlers();
    render(<RemotePanel remotes={makeList([])} onAction={onAction} onFetch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-remote-button'));
    fireEvent.change(await screen.findByTestId('add-remote-name'), { target: { value: 'origin' } });
    fireEvent.change(screen.getByTestId('add-remote-url'), {
      target: { value: 'https://example.com/a.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      action: 'add',
      name: 'origin',
      url: 'https://example.com/a.git',
    });
  });
});

describe('RemotePanel 编辑远程', () => {
  it('点编辑开 Modal 且 url 预填当前 fetchUrl；提交以 {action:"setUrl",name,url} 调 onAction', async () => {
    const { onAction } = makeHandlers();
    render(<RemotePanel remotes={REMOTES} onAction={onAction} onFetch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('edit-remote-origin'));
    const urlInput = await screen.findByTestId('edit-remote-url');
    expect(urlInput).toHaveValue('https://example.com/a.git');
    fireEvent.change(urlInput, { target: { value: 'https://example.com/a2.git' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      action: 'setUrl',
      name: 'origin',
      url: 'https://example.com/a2.git',
    });
  });
});

describe('RemotePanel 删除远程', () => {
  it('删除走 Popconfirm，确认后以 {action:"remove",name} 调 onAction', async () => {
    const { onAction } = makeHandlers();
    render(<RemotePanel remotes={REMOTES} onAction={onAction} onFetch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('remove-remote-upstream'));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'remove', name: 'upstream' });
  });
});

describe('RemotePanel fetch', () => {
  it('行级 fetch 按钮：以远程名调 onFetch', () => {
    const { onFetch } = makeHandlers();
    render(<RemotePanel remotes={REMOTES} onAction={vi.fn()} onFetch={onFetch} />);
    fireEvent.click(screen.getByTestId('fetch-remote-origin'));
    expect(onFetch).toHaveBeenCalledTimes(1);
    expect(onFetch).toHaveBeenCalledWith('origin');
  });

  it('顶部 fetch 全部按钮：无参调 onFetch', () => {
    const { onFetch } = makeHandlers();
    render(<RemotePanel remotes={REMOTES} onAction={vi.fn()} onFetch={onFetch} />);
    fireEvent.click(screen.getByTestId('fetch-all-button'));
    expect(onFetch).toHaveBeenCalledTimes(1);
    expect(onFetch).toHaveBeenCalledWith();
  });
});

describe('RemotePanel 定制 refspec / 解除浅克隆', () => {
  it('未传 onFetchSpec 时不渲染「定制 Fetch…」入口', () => {
    render(<RemotePanel remotes={REMOTES} {...makeHandlers()} />);
    expect(screen.queryByTestId('fetch-spec-button')).not.toBeInTheDocument();
  });

  it('定制 Fetch：选远程 + 填 refspec 后以 (remote, refspec) 回调', async () => {
    const onFetchSpec = vi.fn();
    render(<RemotePanel remotes={REMOTES} onAction={vi.fn()} onFetch={vi.fn()} onFetchSpec={onFetchSpec} />);
    fireEvent.click(screen.getByTestId('fetch-spec-button'));
    // 未选远程/未填 refspec 时确定禁用
    expect(screen.getByRole('button', { name: /确\s*定/ })).toBeDisabled();

    fireEvent.mouseDown(screen.getByTestId('fetch-spec-remote'));
    const options = await screen.findAllByText('upstream');
    fireEvent.click(options[options.length - 1]);
    fireEvent.change(screen.getByTestId('fetch-spec-refspec'), {
      target: { value: '  +refs/pull/7/head:refs/remotes/origin/pr-7  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onFetchSpec).toHaveBeenCalledWith('upstream', '+refs/pull/7/head:refs/remotes/origin/pr-7');
  });

  it('shallow 时渲染「解除浅克隆」并按首个远程名回调；未传 onUnshallow 则不渲染', () => {
    const onUnshallow = vi.fn();
    const { unmount } = render(
      <RemotePanel
        remotes={{ remotes: REMOTES.remotes, shallow: true }}
        onAction={vi.fn()}
        onFetch={vi.fn()}
        onUnshallow={onUnshallow}
      />,
    );
    fireEvent.click(screen.getByTestId('unshallow-button'));
    expect(onUnshallow).toHaveBeenCalledWith('origin');
    unmount();

    render(<RemotePanel remotes={{ remotes: REMOTES.remotes, shallow: true }} {...makeHandlers()} />);
    expect(screen.queryByTestId('unshallow-button')).not.toBeInTheDocument();
  });
});
