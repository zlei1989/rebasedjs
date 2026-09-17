import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyOnClick } from './copy-on-click';
import { copyToClipboard } from './clipboard';

/** 剪贴板桩：返回 writeText 供断言 */
function stubClipboard(impl?: () => Promise<void>): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('copyToClipboard', () => {
  it('走 navigator.clipboard.writeText 并回报成功', async () => {
    const writeText = stubClipboard();
    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('浏览器拒绝权限时回报失败（不谎报成功）', async () => {
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')));
    // 无 document.execCommand（jsdom）时兜底也失败 → false
    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });

  it('无 clipboard API 时退回 execCommand 兜底', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await expect(copyToClipboard('fallback')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // 兜底用的临时 textarea 必须清干净（否则每次复制都在 body 里留一个节点）
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});

describe('CopyOnClick', () => {
  it('渲染为真实 button（可聚焦、键盘可达），文本原样展示', () => {
    render(
      <CopyOnClick text="full" hint="点击复制" data-testid="copy-on-click">
        short
      </CopyOnClick>,
    );
    const button = screen.getByTestId('copy-on-click');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveTextContent('short');
  });

  it('点击把 text（而非展示文本）写进剪贴板，并给出「已复制」态', async () => {
    const writeText = stubClipboard();
    render(
      <CopyOnClick text="871f02c8281e522e84c5feccbdff90b608f0dc0b" hint="点击复制完整 hash" data-testid="copy-on-click">
        871f02c
      </CopyOnClick>,
    );
    fireEvent.click(screen.getByTestId('copy-on-click'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('871f02c8281e522e84c5feccbdff90b608f0dc0b'));
    await waitFor(() => expect(screen.getByTestId('copy-on-click')).toHaveAttribute('data-copied', 'true'));
  });

  it('写失败（权限被拒）不进入「已复制」态', async () => {
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')));
    render(
      <CopyOnClick text="x" hint="点击复制" data-testid="copy-on-click">
        x
      </CopyOnClick>,
    );
    fireEvent.click(screen.getByTestId('copy-on-click'));
    // 等一拍：写失败的 Promise 已 settle，但状态不该被置位
    await Promise.resolve();
    expect(screen.getByTestId('copy-on-click')).not.toHaveAttribute('data-copied');
  });
});

describe('CopyOnClick plain 模式', () => {
  it('渲染为无样式的 span（唯一样式 cursor: copy），不带图标与虚线', () => {
    render(
      <CopyOnClick plain text="full" data-testid="copy-plain">
        short
      </CopyOnClick>,
    );
    const span = screen.getByTestId('copy-plain');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveTextContent('short');
    // 没有任何子元素（无复制图标），inline 样式只有一条 cursor: copy
    expect(span.children).toHaveLength(0);
    expect(span.style.length).toBe(1);
    expect(span.style.cursor).toBe('copy');
  });

  it('不点击不出任何气泡（悬停也不出 hint、不出「已复制」）', async () => {
    // 对照组：同环境下非 plain 的悬停气泡确实会弹——证明 jsdom 里 mouseEnter 能触发 antd 气泡，
    // 下面 plain 的「什么都不出」才不是空转
    const control = render(
      <CopyOnClick text="ctrl" hint="对照组悬停提示" data-testid="copy-ctrl">
        ctrl
      </CopyOnClick>,
    );
    fireEvent.mouseEnter(screen.getByTestId('copy-ctrl'));
    expect(await screen.findByText('对照组悬停提示')).toBeInTheDocument();
    control.unmount();

    // plain：同样的悬停，hint 与「已复制」都不出（open 受控于 copied，悬停触发被绕过）
    render(
      <CopyOnClick plain text="x" hint="点击复制" data-testid="copy-plain">
        x
      </CopyOnClick>,
    );
    fireEvent.mouseEnter(screen.getByTestId('copy-plain'));
    expect(screen.queryByText('点击复制')).toBeNull();
    expect(screen.queryByText('已复制到剪贴板')).toBeNull();
  });

  it('点击复制成功后弹出「已复制」气泡（hint 可省略）', async () => {
    const writeText = stubClipboard();
    render(
      <CopyOnClick plain text="871f02c8281e522e84c5feccbdff90b608f0dc0b" data-testid="copy-plain">
        871f02c
      </CopyOnClick>,
    );
    fireEvent.click(screen.getByTestId('copy-plain'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('871f02c8281e522e84c5feccbdff90b608f0dc0b'));
    expect(await screen.findByText('已复制到剪贴板')).toBeInTheDocument();
    expect(screen.getByTestId('copy-plain')).toHaveAttribute('data-copied', 'true');
  });

  it('写失败（权限被拒）不弹气泡（不谎报成功）', async () => {
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')));
    render(
      <CopyOnClick plain text="x" data-testid="copy-plain">
        x
      </CopyOnClick>,
    );
    fireEvent.click(screen.getByTestId('copy-plain'));
    // 等一拍：写失败的 Promise 已 settle，但状态不该被置位、气泡不该弹
    await Promise.resolve();
    expect(screen.queryByText('已复制到剪贴板')).toBeNull();
    expect(screen.getByTestId('copy-plain')).not.toHaveAttribute('data-copied');
  });
});
