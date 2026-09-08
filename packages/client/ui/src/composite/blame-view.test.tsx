import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BlameLine, CommittedEntry } from '@rebased/contracts';
import { BlameView } from './blame-view';

/** 测试溯源行工厂：补全 BlameLine 必填字段 */
function makeBlameLine(partial: Partial<BlameLine> & { lineno: number }): BlameLine {
  return {
    hash: `hash${partial.lineno}`,
    shortHash: `abc${partial.lineno}`,
    author: `author ${partial.lineno}`,
    authorEmail: `a${partial.lineno}@example.com`,
    dateIso: '2026-01-01T00:00:00Z',
    content: `content ${partial.lineno}`,
    previousLineno: null,
    parents: [],
    ...partial,
  };
}

/** 测试提交条目工厂：补全 CommittedEntry 必填字段 */
function makeEntry(partial: Partial<CommittedEntry> & { hash: string }): CommittedEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: 'a commit',
    author: 'Sam',
    dateIso: '2026-01-02T00:00:00Z',
    parents: [],
    files: [{ path: 'src/app.ts', status: 'M' }],
    ...partial,
  };
}

describe('BlameView 渲染', () => {
  it('渲染文件路径头与每行的行号/作者/日期/内容', () => {
    const lines = [
      makeBlameLine({ lineno: 1, content: 'const a = 1;' }),
      makeBlameLine({ lineno: 2, content: 'const b = 2;' }),
    ];
    render(<BlameView file="src/app.ts" lines={lines} />);

    expect(screen.getByTestId('blame-file')).toHaveTextContent('src/app.ts');

    const row1 = screen.getByTestId('blame-line-1');
    expect(row1).toHaveTextContent('1');
    expect(row1).toHaveTextContent('author 1');
    expect(row1).toHaveTextContent('2026-01-01 00:00');
    expect(row1).toHaveTextContent('const a = 1;');

    const row2 = screen.getByTestId('blame-line-2');
    expect(row2).toHaveTextContent('2');
    expect(row2).toHaveTextContent('author 2');
    expect(row2).toHaveTextContent('2026-01-01 00:00');
    expect(row2).toHaveTextContent('const b = 2;');
  });

  it('无行数据时渲染 EmptyState', () => {
    render(<BlameView file="src/app.ts" lines={[]} />);
    expect(screen.getByText('暂无溯源信息')).toBeInTheDocument();
  });
});

describe('BlameView 状态', () => {
  it('loading 时渲染加载态', () => {
    render(<BlameView file="src/app.ts" loading />);
    expect(screen.getByTestId('blame-loading')).toBeInTheDocument();
  });

  it('error 时渲染错误文案', () => {
    render(<BlameView file="src/app.ts" error="加载失败" />);
    expect(screen.getByTestId('blame-error')).toHaveTextContent('加载失败');
  });
});

describe('BlameView 行交互', () => {
  it('点击 hash 徽标以完整哈希调 onOpenCommit', () => {
    const onOpenCommit = vi.fn();
    render(<BlameView file="src/app.ts" lines={[makeBlameLine({ lineno: 3 })]} onOpenCommit={onOpenCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'abc3' }));

    expect(onOpenCommit).toHaveBeenCalledTimes(1);
    expect(onOpenCommit).toHaveBeenCalledWith('hash3');
  });

  it('行内「差异」以 (hash, parents) 调 onShowDiff；「历史」以 file 调 onShowInHistory', () => {
    const onShowDiff = vi.fn();
    const onShowInHistory = vi.fn();
    render(
      <BlameView
        file="src/app.ts"
        lines={[makeBlameLine({ lineno: 1, parents: ['parent111'] })]}
        onShowDiff={onShowDiff}
        onShowInHistory={onShowInHistory}
      />,
    );

    fireEvent.click(screen.getByTestId('blame-diff-1'));
    fireEvent.click(screen.getByTestId('blame-history-1'));

    expect(onShowDiff).toHaveBeenCalledWith('hash1', ['parent111']);
    expect(onShowInHistory).toHaveBeenCalledWith('src/app.ts');
  });

  it('未传 onShowDiff/onShowInHistory 时不渲染对应按钮', () => {
    render(<BlameView file="src/app.ts" lines={[makeBlameLine({ lineno: 1 })]} />);
    expect(screen.queryByTestId('blame-diff-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blame-history-1')).not.toBeInTheDocument();
  });
});

describe('BlameView 受影响（Show All Affected #34）', () => {
  it('点击「受影响」以 hash 调 onShowAffected；affectedHash 受控打开 Modal（loading 态）', () => {
    const onShowAffected = vi.fn();
    const { rerender } = render(
      <BlameView
        file="src/app.ts"
        lines={[makeBlameLine({ lineno: 1 })]}
        onShowAffected={onShowAffected}
        affectedHash=""
        affectedLoading={false}
        affectedEntry={null}
      />,
    );

    // 关闭态（hash 空）不渲染 Modal 内容
    expect(screen.queryByTestId('affected-loading')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('blame-affected-1'));

    expect(onShowAffected).toHaveBeenCalledTimes(1);
    expect(onShowAffected).toHaveBeenCalledWith('hash1');

    // 容器回写 hash（条件拉取进行中）→ Modal 打开且 loading 态
    rerender(
      <BlameView
        file="src/app.ts"
        lines={[makeBlameLine({ lineno: 1 })]}
        onShowAffected={onShowAffected}
        affectedHash="hash1"
        affectedLoading
        affectedEntry={null}
      />,
    );
    expect(screen.getByTestId('affected-loading')).toBeInTheDocument();
  });

  it('数据就绪：Modal 渲染提交元信息与全量文件（含状态徽标与重命名原名）', () => {
    render(
      <BlameView
        file="src/app.ts"
        lines={[makeBlameLine({ lineno: 1 })]}
        onShowAffected={vi.fn()}
        affectedHash="aaaaaa1"
        affectedLoading={false}
        affectedEntry={makeEntry({
          hash: 'aaaaaa1',
          subject: 'rename and touch',
          parents: ['p1'],
          files: [
            { path: 'b.ts', status: 'R', renameFrom: 'a.ts' },
            { path: 'c.ts', status: 'A' },
          ],
        })}
      />,
    );

    expect(screen.getByText(/受影响文件（aaaaaa1）/)).toBeInTheDocument();
    expect(screen.getByText('rename and touch · Sam · 2026-01-02 00:00')).toBeInTheDocument();
    const row0 = screen.getByTestId('affected-file-0');
    expect(row0).toHaveTextContent('R');
    expect(row0).toHaveTextContent('a.ts →');
    expect(row0).toHaveTextContent('b.ts');
    expect(screen.getByTestId('affected-file-1')).toHaveTextContent('c.ts');
  });

  it('文件点击以路径调 onOpenAffectedFile；关闭触发 onCloseAffected', () => {
    const onOpenAffectedFile = vi.fn();
    const onCloseAffected = vi.fn();
    render(
      <BlameView
        file="src/app.ts"
        lines={[makeBlameLine({ lineno: 1 })]}
        onShowAffected={vi.fn()}
        onCloseAffected={onCloseAffected}
        onOpenAffectedFile={onOpenAffectedFile}
        affectedHash="aaaaaa1"
        affectedLoading={false}
        affectedEntry={makeEntry({ hash: 'aaaaaa1' })}
      />,
    );
    fireEvent.click(screen.getByTestId('affected-file-0'));

    expect(onOpenAffectedFile).toHaveBeenCalledWith('src/app.ts');

    // 关闭 Modal（右上角 X：antd 默认 aria-label="Close"）：关闭回调通知容器清空 hash（停止条件拉取）
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCloseAffected).toHaveBeenCalledTimes(1);
  });

  it('error 态渲染错误文案；未传 onShowAffected 不渲染按钮', () => {
    const { rerender } = render(
      <BlameView
        file="src/app.ts"
        lines={[makeBlameLine({ lineno: 1 })]}
        onShowAffected={vi.fn()}
        affectedHash="deadbeef"
        affectedLoading={false}
        affectedError="引用不存在或不是提交：deadbeef"
      />,
    );
    expect(screen.getByTestId('affected-error')).toHaveTextContent('引用不存在或不是提交：deadbeef');

    rerender(<BlameView file="src/app.ts" lines={[makeBlameLine({ lineno: 1 })]} />);
    expect(screen.queryByTestId('blame-affected-1')).not.toBeInTheDocument();
  });
});
