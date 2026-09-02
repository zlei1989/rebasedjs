import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(screen.getByText('Alice on 2026-09-01 at 14:30')).toBeInTheDocument();
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
});
