import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileHistoryEntry } from '@rebased/contracts';
import { BlameCommitsColumn } from './blame-commits-column';

/** 历史条目工厂 */
function makeEntry(partial: Partial<FileHistoryEntry> & { hash: string }): FileHistoryEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: `subject ${partial.hash}`,
    author: 'Sam',
    dateIso: '2026-01-02T10:00:00+00:00',
    parents: ['p1'],
    ...partial,
  };
}

describe('BlameCommitsColumn（该文件的提交清单）', () => {
  it('每行渲染短哈希/标题/作者/日期', () => {
    render(<BlameCommitsColumn entries={[makeEntry({ hash: 'aaaaaaaa', subject: 'fix: 修一个 bug' })]} />);
    const row = screen.getByTestId('blame-commit-0');
    // 短哈希按工厂口径取 hash 前 7 位（'aaaaaaaa' → 'aaaaaaa'，与仓库其余夹具的 slice(0, 7) 一致）：
    // brief 原文此处写 8 个 a，与它自己的工厂算术矛盾（8 位串截 7 位只剩 7 个 a），逐字使用必不可过，
    // 故按工厂的真实输出断言 7 位（RED 实测行文本为 'aaaaaaafix: 修一个 bug…'）。
    expect(row).toHaveTextContent('aaaaaaa');
    expect(row).toHaveTextContent('fix: 修一个 bug');
    expect(row).toHaveTextContent('Sam');
    expect(row).toHaveTextContent('2026-01-02 10:00');
  });

  it('点行以完整哈希调 onSelect；选中行带 data-selected', () => {
    const onSelect = vi.fn();
    render(
      <BlameCommitsColumn
        entries={[makeEntry({ hash: 'h1' }), makeEntry({ hash: 'h2' })]}
        selectedHash="h2"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByTestId('blame-commit-0')).not.toHaveAttribute('data-selected');
    expect(screen.getByTestId('blame-commit-1')).toHaveAttribute('data-selected', 'true');
    fireEvent.click(screen.getByTestId('blame-commit-0'));
    expect(onSelect).toHaveBeenCalledWith('h1');
  });

  it('陈旧 ?select=（不在清单里）：没有任何行处于选中态', () => {
    render(<BlameCommitsColumn entries={[makeEntry({ hash: 'h1' })]} selectedHash="已不在清单里的哈希" />);
    expect(screen.getByTestId('blame-commit-0')).not.toHaveAttribute('data-selected');
  });

  it('loading / error / 空清单三态', () => {
    const { rerender } = render(<BlameCommitsColumn loading />);
    expect(screen.getByTestId('blame-commits-loading')).toBeInTheDocument();
    rerender(<BlameCommitsColumn error="加载失败" />);
    expect(screen.getByTestId('blame-commits-error')).toHaveTextContent('加载失败');
    rerender(<BlameCommitsColumn entries={[]} />);
    expect(screen.getByText('该文件暂无提交记录')).toBeInTheDocument();
  });

  it('未注入 onSelect：行只读（点击不调任何回调、不抛错）', () => {
    render(<BlameCommitsColumn entries={[makeEntry({ hash: 'h1' })]} />);
    fireEvent.click(screen.getByTestId('blame-commit-0'));
    expect(screen.getByTestId('blame-commit-0')).toBeInTheDocument();
  });

  // 行是本页主导航的唯一入口，只挂 onClick 的 div 键盘够不到（Listy 行容器不带 tabIndex/键盘处理）——
  // 故补键鼠等效的激活路径，与注解行表同口径（见组件内注释）
  it.each([
    { name: 'Enter', key: 'Enter', prevented: false },
    { name: 'Space', key: ' ', prevented: true },
  ])('键盘 $name 激活行：以完整哈希调 onSelect', ({ key, prevented }) => {
    const onSelect = vi.fn();
    render(<BlameCommitsColumn entries={[makeEntry({ hash: 'fullhash' })]} onSelect={onSelect} />);
    const row = screen.getByTestId('blame-commit-0');
    // 经 createEvent 取原生事件对象：Space 必须 preventDefault（默认行为是滚动清单），Enter 不该拦
    const event = createEvent.keyDown(row, { key });
    fireEvent(row, event);
    expect(event.defaultPrevented).toBe(prevented);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('fullhash');
  });

  it('可点行可聚焦（role=button + tabIndex 0），未注入 onSelect 的行不可聚焦', () => {
    const { unmount } = render(<BlameCommitsColumn entries={[makeEntry({ hash: 'h1' })]} onSelect={() => {}} />);
    const row = screen.getByTestId('blame-commit-0');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('role', 'button');
    unmount();

    // 无死控件：未注入回调时 Tab 不该停在一个按了没反应的行上
    render(<BlameCommitsColumn entries={[makeEntry({ hash: 'h1' })]} />);
    expect(screen.getByTestId('blame-commit-0')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('blame-commit-0')).not.toHaveAttribute('role');
  });
});
