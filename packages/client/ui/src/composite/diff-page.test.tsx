import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileVersions } from '@rebased/contracts';
import { DiffPage } from './diff-page';

const versions: FileVersions = { before: '旧内容', after: '新内容' };

/** 注入 stub loader，绕过真实 monaco 加载 */
const stubLoader = (): Promise<{ default: () => React.ReactNode }> =>
  Promise.resolve({ default: () => <div>stub-diff-editor</div> });

describe('DiffPage', () => {
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

  it('忽略空白开关默认关闭，打开时触发 onToggleWhitespace(true)', () => {
    const onToggleWhitespace = vi.fn();
    render(
      <DiffPage
        versions={versions}
        file="src/app.ts"
        staged={false}
        onToggleWhitespace={onToggleWhitespace}
        loader={stubLoader}
      />,
    );
    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onToggleWhitespace).toHaveBeenCalledWith(true);
  });
});
