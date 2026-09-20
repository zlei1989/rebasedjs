import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommittedEntry } from '@rebased/contracts';
import { AffectedFilesModal } from './affected-files-modal';

/** 测试提交条目工厂：补全 CommittedEntry 必填字段 */
function makeEntry(partial: Partial<CommittedEntry> & { hash: string }): CommittedEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: 'a commit',
    author: 'Sam',
    dateIso: '2026-01-02T00:00:00+00:00',
    parents: [],
    files: [{ path: 'src/app.ts', status: 'M' }],
    ...partial,
  };
}

describe('AffectedFilesModal（受影响文件清单）', () => {
  it('hash 为空串时关闭：不渲染内容', () => {
    render(<AffectedFilesModal hash="" entry={null} loading={false} />);
    expect(screen.queryByTestId('affected-loading')).not.toBeInTheDocument();
  });

  it('加载中渲染 loading 态', () => {
    render(<AffectedFilesModal hash="aaaaaa1" entry={null} loading />);
    expect(screen.getByTestId('affected-loading')).toBeInTheDocument();
  });

  it('数据就绪：渲染提交元信息与全量文件（含状态徽标与重命名原名）', () => {
    render(
      <AffectedFilesModal
        hash="aaaaaa1"
        loading={false}
        entry={makeEntry({
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
    expect(screen.getByTestId('affected-file-0')).toHaveTextContent('a.ts →');
    expect(screen.getByTestId('affected-file-0')).toHaveTextContent('b.ts');
    expect(screen.getByTestId('affected-file-1')).toHaveTextContent('c.ts');
  });

  it('文件点击以路径调 onOpenFile；关闭以 X 触发 onClose', () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    render(
      <AffectedFilesModal hash="aaaaaa1" loading={false} entry={makeEntry({ hash: 'aaaaaa1' })} onOpenFile={onOpenFile} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('affected-file-0'));
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');
    // 关闭 Modal（右上角 X：antd 默认 aria-label="Close"）
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('error 态渲染错误文案', () => {
    render(<AffectedFilesModal hash="deadbeef" loading={false} error="引用不存在或不是提交：deadbeef" />);
    expect(screen.getByTestId('affected-error')).toHaveTextContent('引用不存在或不是提交：deadbeef');
  });

  it('空变更集：普通提交提示「无文件变更」，合并提交提示去日志页看合并结果', () => {
    const { rerender } = render(
      <AffectedFilesModal hash="aaaaaa1" loading={false} entry={makeEntry({ hash: 'aaaaaa1', files: [] })} />,
    );
    expect(screen.getByText('该提交无文件变更')).toBeInTheDocument();
    rerender(
      <AffectedFilesModal hash="aaaaaa1" loading={false} entry={makeEntry({ hash: 'aaaaaa1', parents: ['p1', 'p2'], files: [] })} />,
    );
    expect(screen.getByText('合并提交')).toBeInTheDocument();
  });
});
