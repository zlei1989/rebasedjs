import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine, CommittedEntry } from '@rebased/contracts';
import type { HighlightToken } from '../domain/highlight';
import type { LineHighlighterLoader } from '../base/line-highlighter';
import { BlameAnnotateTable } from './blame-annotate-table';

/** 工作区未提交行的伪哈希（git blame 的边界提交） */
const ZERO_HASH = '0'.repeat(40);

/** 测试溯源行工厂：补全 BlameLine 必填字段 */
function makeLine(partial: Partial<BlameLine> & { lineno: number }): BlameLine {
  return {
    hash: `hash${partial.lineno}`,
    shortHash: `abc${partial.lineno}`,
    author: `author ${partial.lineno}`,
    authorEmail: `a${partial.lineno}@example.com`,
    dateIso: '2026-01-01T00:00:00+00:00',
    content: `content ${partial.lineno}`,
    previousLineno: null,
    parents: [],
    ...partial,
  };
}

/** 测试提交详情工厂：只填提交详情卡消费得到的字段 */
function makeEntry(partial: Partial<CommittedEntry> & { hash: string }): CommittedEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: '主题',
    message: '主题',
    author: 'Test User',
    dateIso: '2026-01-01T00:00:00+00:00',
    parents: [],
    files: [],
    ...partial,
  };
}

/**
 * 高亮桩：逐行 token 由测试给定（jsdom 起不了 shiki 的 wasm，与 code-block 同一手法）。
 * 每行切成两个 token，便于断言「按行取 token」而不是整块 HTML。
 */
function stubLoader(lines: HighlightToken[][]): LineHighlighterLoader {
  return () => Promise.resolve({ highlightLines: () => Promise.resolve(lines) });
}

describe('BlameAnnotateTable 渲染', () => {
  it('每行渲染行号/时间/哈希/内容；作者不再占列（移入哈希浮层）', () => {
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, content: 'const a = 1;' }), makeLine({ lineno: 2, content: 'const b = 2;' })]}
      />,
    );
    const row1 = screen.getByTestId('blame-line-1');
    expect(row1).toHaveTextContent('1');
    expect(row1).toHaveTextContent('2026-01-01 00:00');
    expect(row1).toHaveTextContent('abc1');
    expect(row1).toHaveTextContent('const a = 1;');
    // 用户口径：行内只有 行号｜时间｜哈希 + 内容；作者（及其邮箱）只在浮层里出现
    expect(row1).not.toHaveTextContent('author 1');
    expect(screen.getByTestId('blame-line-2')).toHaveTextContent('const b = 2;');
  });

  it('loading / error / 空行三态', () => {
    const { rerender } = render(<BlameAnnotateTable loading />);
    expect(screen.getByTestId('blame-loading')).toBeInTheDocument();
    rerender(<BlameAnnotateTable error="加载失败" />);
    expect(screen.getByTestId('blame-error')).toHaveTextContent('加载失败');
    rerender(<BlameAnnotateTable lines={[]} />);
    expect(screen.getByText('暂无溯源信息')).toBeInTheDocument();
  });

  it('逐行高亮：按行取 loader 的 token，双主题样式落在每个 token 上', async () => {
    const loader = stubLoader([
      [{ content: 'const', htmlStyle: { color: '#D73A49', '--shiki-dark': '#F97583' } }, { content: ' a = 1;' }],
      [{ content: 'const b = 2;' }],
    ]);
    const { container } = render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, content: 'const a = 1;' }), makeLine({ lineno: 2, content: 'const b = 2;' })]}
        language="typescript"
        highlightLoader={loader}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('blame-code-1')).toHaveTextContent('const a = 1;'));
    expect(screen.getByTestId('blame-code-2')).toHaveTextContent('const b = 2;');
    const colored = container.querySelector('[data-testid="blame-code-1"] .code') as HTMLElement | null;
    expect(colored).not.toBeNull();
    // 双主题都落在同一个 token 上：浅色走 color（React 会规范化成 rgb），深色走自定义属性 --shiki-dark
    expect(colored?.style.color).toBe('rgb(215, 58, 73)');
    expect(colored?.style.getPropertyValue('--shiki-dark')).toBe('#F97583');
  });

  it('高亮不可用（loader 返回 null / 未给语言）时逐行退纯文本，内容不丢', async () => {
    const loader: LineHighlighterLoader = () => Promise.resolve({ highlightLines: () => Promise.resolve(null) });
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1, content: 'const a = 1;' })]} language="unknown-lang" highlightLoader={loader} />);
    // 未就绪/失败都出同一份文本（与 code-block 同口径：不闪空、不阻塞）
    expect(screen.getByTestId('blame-code-1')).toHaveTextContent('const a = 1;');
    await waitFor(() => expect(screen.getByTestId('blame-code-1')).toHaveTextContent('const a = 1;'));
  });

  it('loader 的行数与源文件行数不一致时按纯文本渲染（错位比无色更糟）', async () => {
    const loader = stubLoader([[{ content: '只有一行' }]]);
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, content: 'const a = 1;' }), makeLine({ lineno: 2, content: 'const b = 2;' })]}
        language="typescript"
        highlightLoader={loader}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('blame-code-1')).toHaveTextContent('const a = 1;'));
    expect(screen.getByTestId('blame-code-2')).toHaveTextContent('const b = 2;');
  });
});

describe('BlameAnnotateTable 行交互', () => {
  it('点行以该行归属的提交调 onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 3, hash: 'fullhash3' })]} onSelectCommit={onSelectCommit} />);
    fireEvent.click(screen.getByTestId('blame-line-3'));
    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash3');
  });

  it('选中提交的行带 data-selected，其余行不带', () => {
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1, hash: 'h1' }), makeLine({ lineno: 2, hash: 'h2' })]} selectedHash="h2" />);
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('data-selected');
    expect(screen.getByTestId('blame-line-2')).toHaveAttribute('data-selected', 'true');
  });

  it('工作区未提交行（全 0 伪哈希）：不可点，且不再标注「未提交」', () => {
    const onSelectCommit = vi.fn();
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: ZERO_HASH, shortHash: '0000000' })]}
        onSelectCommit={onSelectCommit}
      />,
    );
    const row = screen.getByTestId('blame-line-1');
    // 用户口径：浮层与选中都由「归属提交」承载，零哈希不是提交——文案去掉，行为（不可点）保留
    expect(row).not.toHaveTextContent('未提交');
    fireEvent.click(row);
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  it('未注入 onSelectCommit：行只读（点击不抛错）', () => {
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1 })]} />);
    fireEvent.click(screen.getByTestId('blame-line-1'));
    expect(screen.getByTestId('blame-line-1')).toBeInTheDocument();
  });

  it.each([
    { name: 'Enter', key: 'Enter', prevented: false },
    { name: 'Space', key: ' ', prevented: true },
  ])('键盘 $name 激活可点行：以完整哈希调 onSelectCommit', ({ key, prevented }) => {
    const onSelectCommit = vi.fn();
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 4, hash: 'fullhash4' })]} onSelectCommit={onSelectCommit} />);
    const row = screen.getByTestId('blame-line-4');
    // 经 createEvent 取原生事件对象：Space 必须 preventDefault（默认行为是滚动页面），Enter 不该拦
    const event = createEvent.keyDown(row, { key });
    fireEvent(row, event);
    expect(event.defaultPrevented).toBe(prevented);
    expect(onSelectCommit).toHaveBeenCalledTimes(1);
    expect(onSelectCommit).toHaveBeenCalledWith('fullhash4');
  });

  it('可点行可聚焦，不可点行（未提交 / 未注入回调）不可聚焦', () => {
    const { unmount } = render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: ZERO_HASH }), makeLine({ lineno: 2, hash: 'h2' })]}
        onSelectCommit={() => {}}
      />,
    );
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('role');
    expect(screen.getByTestId('blame-line-2')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('blame-line-2')).toHaveAttribute('role', 'button');
    unmount();

    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1 })]} />);
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('blame-line-1')).not.toHaveAttribute('role');
  });
});

describe('BlameAnnotateTable 哈希详情浮层', () => {
  it('点哈希：以该行哈希调 onToggleDetail，且**不**触发该行的选中（两者互不代劳）', () => {
    const onToggleDetail = vi.fn();
    const onSelectCommit = vi.fn();
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: 'fullhash1' })]}
        onSelectCommit={onSelectCommit}
        onToggleDetail={onToggleDetail}
      />,
    );
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(onToggleDetail).toHaveBeenCalledWith('fullhash1');
    expect(onSelectCommit).not.toHaveBeenCalled();
  });

  it('点开后再点同一哈希 → onToggleDetail(null)（受控关闭）', () => {
    const onToggleDetail = vi.fn();
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: 'fullhash1' })]}
        onToggleDetail={onToggleDetail}
        detail={{ hash: 'fullhash1', entry: makeEntry({ hash: 'fullhash1' }), authorEmail: 'a@example.com' }}
      />,
    );
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(onToggleDetail).toHaveBeenLastCalledWith('fullhash1');
    expect(screen.getByTestId('commit-detail-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(onToggleDetail).toHaveBeenLastCalledWith(null);
    /* 「浮层真的收起了」不在这里断言：antd 的关闭走 rc-motion（离场动画靠 transitionend/定时器），
       jsdom 不跑这类动画，节点会停在离场前那一帧——按 DOM 判定会得到假阴性。
       视觉层的收起由冒烟在真实浏览器里验（§4.16 F-164）。这里只钉交互契约：两次点击 = 开 → 关。 */
  });

  it('未提交行（全 0 伪哈希）哈希不可点：不调 onToggleDetail', () => {
    const onToggleDetail = vi.fn();
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: ZERO_HASH, shortHash: '0000000' })]}
        onToggleDetail={onToggleDetail}
      />,
    );
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(onToggleDetail).not.toHaveBeenCalled();
  });

  it('未注入 onToggleDetail：哈希不可点（无死控件）', () => {
    render(<BlameAnnotateTable lines={[makeLine({ lineno: 1 })]} />);
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(screen.getByTestId('blame-hash-1')).toBeInTheDocument();
  });

  it('同一提交拥有多行时只弹一个浮层：浮层跟着**被点的行**，不跟着哈希（冒烟实测：b96148e 有 3 行 → 曾同时弹 3 个）', async () => {
    const onToggleDetail = vi.fn();
    const lines = [
      makeLine({ lineno: 1, hash: 'same', shortHash: 'same123' }),
      makeLine({ lineno: 2, hash: 'same', shortHash: 'same123' }),
      makeLine({ lineno: 3, hash: 'same', shortHash: 'same123' }),
    ];
    render(
      <BlameAnnotateTable
        lines={lines}
        onToggleDetail={onToggleDetail}
        detail={{ hash: 'same', authorEmail: 'a@example.com', entry: makeEntry({ hash: 'same', message: '主题' }) }}
      />,
    );
    // 尚未点过任何哈希：一个浮层都不该开（detail 到了不等于「该开」——开合由点击决定）
    expect(screen.queryAllByTestId('commit-detail-card')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('blame-hash-2'));
    expect(onToggleDetail).toHaveBeenCalledWith('same');
    // 只有第 2 行开：同哈希的第 1、3 行不得跟着弹（这正是冒烟里 3 个浮层叠在一起的成因）
    await waitFor(() => expect(screen.getAllByTestId('commit-detail-card')).toHaveLength(1));
    expect(screen.getByTestId('blame-line-2').contains(screen.getByTestId('commit-detail-card'))).toBe(false); // 浮层在 portal 里，不在行内
  });

  it('detail 命中该行时浮层渲染提交详情卡（作者/邮箱/完整提交信息）', async () => {
    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: 'fullhash1' })]}
        onToggleDetail={() => {}}
        detail={{
          hash: 'fullhash1',
          authorEmail: 'a1@example.com',
          entry: makeEntry({ hash: 'fullhash1', message: '主题行\n\n正文第一段', author: '张三' }),
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    const card = await screen.findByTestId('commit-detail-card');
    expect(card).toHaveTextContent('主题行');
    expect(card).toHaveTextContent('正文第一段');
    expect(card).toHaveTextContent('张三');
    expect(card).toHaveTextContent('a1@example.com');
  });

  it('detail 的 loading / error 由浮层如实呈现（不假装有数据）', async () => {
    const { unmount } = render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: 'h1' })]}
        onToggleDetail={() => {}}
        detail={{ hash: 'h1', loading: true }}
      />,
    );
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(screen.getByTestId('blame-detail-loading')).toBeInTheDocument();
    unmount();

    render(
      <BlameAnnotateTable
        lines={[makeLine({ lineno: 1, hash: 'h1' })]}
        onToggleDetail={() => {}}
        detail={{ hash: 'h1', error: '引用不存在或不是提交：deadbeef' }}
      />,
    );
    fireEvent.click(screen.getByTestId('blame-hash-1'));
    expect(screen.getByTestId('blame-detail-error')).toHaveTextContent('引用不存在或不是提交：deadbeef');
  });
});
