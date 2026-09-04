import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteList } from '@rebased/contracts';
import { PushDialog } from './push-dialog';

const TWO_REMOTES: RemoteList = {
  remotes: [
    { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
    { name: 'upstream', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
  ],
};

const ONE_REMOTE: RemoteList = {
  remotes: [{ name: 'gitee', fetchUrl: 'https://gitee.com/a.git', pushUrl: 'https://gitee.com/a.git' }],
};

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

/** 打开远程下拉并点选指定远程（antd v6 Select：mouseDown .ant-select-content 展开、点击选项文本） */
async function selectRemote(testId: string, name: string): Promise<void> {
  fireEvent.mouseDown(screen.getByTestId(testId).querySelector('.ant-select-content')!);
  fireEvent.click(await screen.findByText(name, { selector: '.ant-select-item-option-content' }));
}

describe('PushDialog 默认值', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<PushDialog open={false} remotes={TWO_REMOTES} currentBranch="main" {...makeHandlers()} />);
    expect(screen.queryByText('推送')).not.toBeInTheDocument();
  });

  it('存在 origin 时默认选中 origin；分支默认当前分支；setUpstream 默认勾选', () => {
    render(<PushDialog open remotes={TWO_REMOTES} currentBranch="main" {...makeHandlers()} />);
    expect(screen.getByTestId('push-remote-select')).toHaveTextContent('origin');
    expect(screen.getByTestId('push-branch-input')).toHaveValue('main');
    expect(screen.getByRole('checkbox', { name: /设为上游/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /安全强推/ })).not.toBeChecked();
  });

  it('无 origin 且仅一个远程时默认选中该远程', () => {
    render(<PushDialog open remotes={ONE_REMOTE} currentBranch="main" {...makeHandlers()} />);
    expect(screen.getByTestId('push-remote-select')).toHaveTextContent('gitee');
  });
});

describe('PushDialog 载荷组装', () => {
  it('默认提交：{remote,branch,setUpstream:true}（forceWithLease 未勾不携带）', () => {
    const { onOk } = makeHandlers();
    render(<PushDialog open remotes={TWO_REMOTES} currentBranch="main" onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledWith({ remote: 'origin', branch: 'main', setUpstream: true });
  });

  it('勾选 forceWithLease 后提交：载荷携带 forceWithLease:true', () => {
    const { onOk } = makeHandlers();
    render(<PushDialog open remotes={TWO_REMOTES} currentBranch="main" onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /安全强推/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({
      remote: 'origin',
      branch: 'main',
      forceWithLease: true,
      setUpstream: true,
    });
  });

  it('取消勾选 setUpstream 后提交：载荷不携带 setUpstream', () => {
    const { onOk } = makeHandlers();
    render(<PushDialog open remotes={TWO_REMOTES} currentBranch="main" onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /设为上游/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ remote: 'origin', branch: 'main' });
  });

  it('改选其他远程后提交：载荷携带所选远程', async () => {
    const { onOk } = makeHandlers();
    render(<PushDialog open remotes={TWO_REMOTES} currentBranch="main" onOk={onOk} onCancel={() => {}} />);
    await selectRemote('push-remote-select', 'upstream');
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith({ remote: 'upstream', branch: 'main', setUpstream: true });
  });

  it('点取消触发 onCancel 且不触发 onOk', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<PushDialog open remotes={TWO_REMOTES} currentBranch="main" onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });
});
