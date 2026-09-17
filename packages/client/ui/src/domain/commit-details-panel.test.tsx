import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@rebased/contracts';
import { CommitDetailsPanel } from './commit-details-panel';

const commit: CommitInfo = {
  hash: 'abc1234567890def',
  shortHash: 'abc1234',
  parents: ['parent0000001', 'parent0000002'],
  author: 'Alice',
  authorEmail: 'alice@example.com',
  dateIso: '2026-09-01T14:30:00+08:00',
  refs: ['HEAD -> main', 'origin/main', 'tag: v1.0'],
  message: '加粗的主题行\n\n正文第一段。',
  graph: '',
};

describe('CommitDetailsPanel', () => {
  it('渲染短 hash 与复制按钮', () => {
    render(<CommitDetailsPanel commit={commit} />);
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByTestId('copy-hash')).toBeInTheDocument();
  });

  it('渲染作者与格式化日期（"{author} on {date} at {time}"）', () => {
    render(<CommitDetailsPanel commit={commit} />);
    // 作者行现在是「可复制的姓名」+「纯文本时间戳」两段节点，故按所在行容器的整体文本断言
    // （getByText 的精确匹配不跨元素；这里要验的正是「合起来读是 Java 的那句格式」）
    expect(screen.getByTestId('author-line')).toHaveTextContent('Alice on 2026-09-01 at 14:30');
  });

  /** 剪贴板桩：返回 `writeText` 供断言；每次调用前重置，避免用例间串味 */
  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it('点姓名把「姓名 <邮箱>」写进剪贴板（不含时间戳）', async () => {
    const writeText = stubClipboard();
    render(<CommitDetailsPanel commit={commit} />);
    // fireEvent 而非 user-event：本包未装 @testing-library/user-event（见既有用例统一口径）；
    // 复制是异步的（writeText 返回 Promise），故断言放进 waitFor
    fireEvent.click(screen.getByTestId('copy-author'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Alice <alice@example.com>'));
  });

  it('点短 hash 把完整 hash 写进剪贴板', async () => {
    const writeText = stubClipboard();
    render(<CommitDetailsPanel commit={commit} />);
    fireEvent.click(screen.getByTestId('copy-hash'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc1234567890def'));
  });

  it('点分支 chip / 标签 chip 把引用名写进剪贴板（HEAD -> 前缀已剥离）', async () => {
    const writeText = stubClipboard();
    render(<CommitDetailsPanel commit={commit} />);
    fireEvent.click(screen.getByTestId('copy-ref-origin/main'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('origin/main'));
    fireEvent.click(screen.getByTestId('copy-ref-v1.0'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('v1.0'));
  });

  it('主题行下方渲染完整提交信息正文（无正文时不渲染空块）', () => {
    const { unmount } = render(<CommitDetailsPanel commit={commit} />);
    expect(screen.getByTestId('commit-body')).toHaveTextContent('正文第一段。');
    // 只有主题行（无正文）时不留空块。必须先卸载上一棵：testing-library 的 screen 查的是整个 document，
    // 两次 render 的结果会同时被查到（queryAll 会数到 1 个旧节点而误判）
    unmount();
    render(<CommitDetailsPanel commit={{ ...commit, message: '只有主题' }} />);
    expect(screen.queryByTestId('commit-body')).not.toBeInTheDocument();
  });

  it('点主题行/正文把整条提交信息写进剪贴板', async () => {
    const writeText = stubClipboard();
    render(<CommitDetailsPanel commit={commit} />);
    fireEvent.click(screen.getByTestId('commit-body'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('加粗的主题行\n\n正文第一段。'));
  });

  it('message 首行加粗渲染为 subject', () => {
    render(<CommitDetailsPanel commit={commit} />);
    const subject = screen.getByText('加粗的主题行');
    expect(subject.tagName).toBe('STRONG');
  });

  it('refs 按分支/标签分两组 chips', () => {
    render(<CommitDetailsPanel commit={commit} />);
    expect(screen.getByTestId('branch-chips')).toHaveTextContent('main');
    expect(screen.getByTestId('branch-chips')).toHaveTextContent('origin/main');
    expect(screen.getByTestId('tag-chips')).toHaveTextContent('v1.0');
    // HEAD -> 前缀被剥离，不直接出现
    expect(screen.queryByText(/HEAD ->/)).not.toBeInTheDocument();
  });

  it('渲染父提交链接（短 hash）', () => {
    render(<CommitDetailsPanel commit={commit} />);
    const links = screen.getAllByTestId('parent-link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('parent0');
    expect(links[1]).toHaveTextContent('parent0');
  });

  it('无父提交时不渲染父链接区', () => {
    render(<CommitDetailsPanel commit={{ ...commit, parents: [] }} />);
    expect(screen.queryByTestId('parent-link')).not.toBeInTheDocument();
  });

  it('传入 onSelectCommit 时点击父链接回调携带父提交 hash（未传时退化为 #hash 锚点）', () => {
    const { unmount } = render(<CommitDetailsPanel commit={commit} />);
    expect(screen.getAllByTestId('parent-link')[0]).toHaveAttribute('href', '#parent0000001');
    unmount();

    const onSelectCommit = vi.fn();
    render(<CommitDetailsPanel commit={commit} onSelectCommit={onSelectCommit} />);
    fireEvent.click(screen.getAllByTestId('parent-link')[1]);
    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('parent0000002');
  });

  it('未传 onResetHere 时不渲染 Reset 按钮', () => {
    render(<CommitDetailsPanel commit={commit} />);
    expect(screen.queryByTestId('reset-here')).not.toBeInTheDocument();
  });

  it('传入 onResetHere 时点击按钮回调携带当前提交 hash', () => {
    const onResetHere = vi.fn();
    render(<CommitDetailsPanel commit={commit} onResetHere={onResetHere} />);
    fireEvent.click(screen.getByTestId('reset-here'));
    expect(onResetHere).toHaveBeenCalledWith('abc1234567890def');
  });

  it('未传 onCherryPick/onRevert 时不渲染对应按钮', () => {
    render(<CommitDetailsPanel commit={commit} onResetHere={() => {}} />);
    expect(screen.queryByTestId('cherry-pick')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revert')).not.toBeInTheDocument();
  });

  it('传入 onCherryPick 时按钮渲染，点击回调携带当前提交 hash', () => {
    const onCherryPick = vi.fn();
    render(<CommitDetailsPanel commit={commit} onCherryPick={onCherryPick} />);
    fireEvent.click(screen.getByTestId('cherry-pick'));
    expect(onCherryPick).toHaveBeenCalledTimes(1);
    expect(onCherryPick).toHaveBeenCalledWith('abc1234567890def');
  });

  it('传入 onRevert 时按钮渲染，点击回调携带当前提交 hash', () => {
    const onRevert = vi.fn();
    render(<CommitDetailsPanel commit={commit} onRevert={onRevert} />);
    fireEvent.click(screen.getByTestId('revert'));
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onRevert).toHaveBeenCalledWith('abc1234567890def');
  });

  it('未传 onBrowse 时不渲染浏览快照按钮，传入时点击回调携带当前提交 hash', () => {
    render(<CommitDetailsPanel commit={commit} onResetHere={() => {}} />);
    expect(screen.queryByTestId('browse-snapshot')).not.toBeInTheDocument();

    const onBrowse = vi.fn();
    render(<CommitDetailsPanel commit={commit} onBrowse={onBrowse} />);
    fireEvent.click(screen.getByTestId('browse-snapshot'));
    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(onBrowse).toHaveBeenCalledWith('abc1234567890def');
  });
});
