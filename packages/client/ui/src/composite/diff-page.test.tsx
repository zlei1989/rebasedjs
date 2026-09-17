import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileVersions } from '@rebased/contracts';
import type { MonacoDiffInnerProps } from '../base/monaco-diff-view';
import { DiffPage } from './diff-page';

const versions: FileVersions = { before: '旧内容', after: '新内容' };

/** 注入 stub loader，绕过真实 monaco 加载 */
const stubLoader = (): Promise<{ default: () => React.ReactNode }> =>
  Promise.resolve({ default: () => <div>stub-diff-editor</div> });

/** 记录编辑器收到的 props 的 stub loader（用于断言语言等透传字段） */
function captureLoader(sink: Array<MonacoDiffInnerProps>): () => Promise<{ default: (props: MonacoDiffInnerProps) => React.ReactNode }> {
  return () =>
    Promise.resolve({
      default: (props: MonacoDiffInnerProps) => {
        sink.push(props);
        return <div>stub-diff-editor</div>;
      },
    });
}

describe('DiffPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('渲染文件路径与 DiffViewer', async () => {
    render(<DiffPage versions={versions} file="src/app.ts" staged={false} loader={stubLoader} />);
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  it('staged/工作区切换触发 onToggleStaged', () => {
    const onToggleStaged = vi.fn();
    render(
      <DiffPage versions={versions} file="src/app.ts" staged={false} onToggleStaged={onToggleStaged} loader={stubLoader} />,
    );
    fireEvent.click(screen.getByText('已暂存'));
    expect(onToggleStaged).toHaveBeenCalledWith(true);
  });

  it('忽略空白开关默认关闭，打开即切换并记进本机偏好（不再是页面状态）', () => {
    render(<DiffPage versions={versions} file="src/app.ts" staged={false} loader={stubLoader} />);
    const toggle = screen.getByTestId('diff-ignore-ws');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(window.localStorage.getItem('rebased.diff.ignoreWhitespace')).toBe('true');
  });

  it('传入 renameFrom 时渲染重命名提示行且不渲染伪 diff（monaco 视图缺席）', async () => {
    render(
      <DiffPage
        versions={versions}
        file="renamed.txt"
        renameFrom="b.txt"
        staged={false}
        loader={stubLoader}
      />,
    );
    expect(screen.getByText('renamed.txt')).toBeInTheDocument();
    const hint = screen.getByTestId('diff-rename-hint');
    expect(hint.textContent).toContain('b.txt');
    expect(hint.textContent).toContain('renamed.txt');
    expect(await screen.queryByText('stub-diff-editor')).not.toBeInTheDocument();
  });

  it('未传 renameFrom 时不渲染重命名提示行', async () => {
    render(<DiffPage versions={versions} file="src/app.ts" staged={false} loader={stubLoader} />);
    expect(screen.queryByTestId('diff-rename-hint')).not.toBeInTheDocument();
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  it('rootCommit 时渲染根提交提示行且不渲染伪 diff（终审 Must-fix 2）', async () => {
    render(
      <DiffPage versions={versions} file="a.txt" staged={false} rootCommit loader={stubLoader} />,
    );
    // 文件路径为页头独立元素；提示行确认内容 + 无伪 diff（monaco 视图缺席）
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByTestId('diff-root-hint')).toBeInTheDocument();
    expect(await screen.queryByText('stub-diff-editor')).not.toBeInTheDocument();
  });

  it('fromTo 模式透传：staged/工作区切换不可见（终审 Must-fix 3）', async () => {
    render(<DiffPage versions={versions} file="src/app.ts" staged={false} fromTo loader={stubLoader} />);
    expect(screen.queryByText('工作区')).not.toBeInTheDocument();
    expect(screen.queryByText('已暂存')).not.toBeInTheDocument();
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  // 语法高亮：容器只给文件路径，语言 id 由本组件按扩展名推断后透传给 diff 视图（此前缺省 plaintext → 两侧无高亮）
  it('未显式传 language 时按文件扩展名推断高亮语言；显式传入时以传入为准', async () => {
    const captured: Array<MonacoDiffInnerProps> = [];
    const loader = captureLoader(captured);
    const { rerender } = render(<DiffPage versions={versions} file="src/app.ts" staged={false} loader={loader} />);
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
    expect(captured.at(-1)?.language).toBe('typescript');
    // 未收录的扩展名不猜语言：交给 monaco 退到 plaintext
    rerender(<DiffPage versions={versions} file="notes.unknown-ext" staged={false} loader={loader} />);
    expect(captured.at(-1)?.language).toBeUndefined();
    rerender(<DiffPage versions={versions} file="src/app.ts" staged={false} language="python" loader={loader} />);
    expect(captured.at(-1)?.language).toBe('python');
  });
});

describe('DiffPage 多文件 Prev/Next（#27）', () => {
  it('files 组渲染导航：末位禁用 Next、首位禁用 Prev；点击以相邻文件回调', async () => {
    const onNavigateFile = vi.fn();
    const files = ['a.txt', 'b/c.txt', 'd.txt'];
    const { rerender } = render(
      <DiffPage versions={versions} file="b/c.txt" staged={false} files={files} onNavigateFile={onNavigateFile} loader={stubLoader} />,
    );
    expect(screen.getByText('2/3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('diff-prev-file'));
    expect(onNavigateFile).toHaveBeenCalledWith('a.txt');
    fireEvent.click(screen.getByTestId('diff-next-file'));
    expect(onNavigateFile).toHaveBeenCalledWith('d.txt');

    rerender(<DiffPage versions={versions} file="a.txt" staged={false} files={files} onNavigateFile={onNavigateFile} loader={stubLoader} />);
    expect(screen.getByTestId('diff-prev-file')).toBeDisabled();
    rerender(<DiffPage versions={versions} file="d.txt" staged={false} files={files} onNavigateFile={onNavigateFile} loader={stubLoader} />);
    expect(screen.getByTestId('diff-next-file')).toBeDisabled();
  });

  it('files < 2 或未注入：导航不渲染（含当前文件不在组内）', async () => {
    const onNavigateFile = vi.fn();
    const { rerender } = render(
      <DiffPage versions={versions} file="a.txt" staged={false} files={['a.txt']} onNavigateFile={onNavigateFile} loader={stubLoader} />,
    );
    expect(screen.queryByTestId('diff-file-nav')).not.toBeInTheDocument();
    rerender(
      <DiffPage versions={versions} file="a.txt" staged={false} files={['x.txt', 'y.txt']} onNavigateFile={onNavigateFile} loader={stubLoader} />,
    );
    expect(screen.queryByTestId('diff-file-nav')).not.toBeInTheDocument();
    rerender(<DiffPage versions={versions} file="a.txt" staged={false} loader={stubLoader} />);
    expect(screen.queryByTestId('diff-file-nav')).not.toBeInTheDocument();
  });
});
