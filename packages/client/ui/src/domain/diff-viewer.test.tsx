import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileVersions } from '@rebased/contracts';
import { DiffViewer } from './diff-viewer';

const versions: FileVersions = { before: '旧内容', after: '新内容' };

/** 注入 stub loader，绕过真实 monaco 加载 */
const stubLoader = (): Promise<{ default: () => React.ReactNode }> =>
  Promise.resolve({ default: () => <div>stub-diff-editor</div> });

describe('DiffViewer', () => {
  it('模式切换按钮存在，默认并排', async () => {
    render(<DiffViewer versions={versions} staged={false} ignoreWhitespace={false} loader={stubLoader} />);
    expect(screen.getByText('并排')).toBeInTheDocument();
    expect(screen.getByText('行内')).toBeInTheDocument();
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  it('点击「行内」切换 diff 呈现模式', async () => {
    render(<DiffViewer versions={versions} staged={false} ignoreWhitespace={false} loader={stubLoader} />);
    fireEvent.click(screen.getByText('行内'));
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  it('staged/工作区切换触发 onToggleStaged', () => {
    const onToggleStaged = vi.fn();
    render(
      <DiffViewer
        versions={versions}
        staged={false}
        onToggleStaged={onToggleStaged}
        ignoreWhitespace={false}
        loader={stubLoader}
      />,
    );
    fireEvent.click(screen.getByText('已暂存'));
    expect(onToggleStaged).toHaveBeenCalledWith(true);
  });

  it('忽略空白开关触发 onToggleWhitespace', () => {
    const onToggleWhitespace = vi.fn();
    render(
      <DiffViewer
        versions={versions}
        staged={false}
        ignoreWhitespace={false}
        onToggleWhitespace={onToggleWhitespace}
        loader={stubLoader}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggleWhitespace).toHaveBeenCalledWith(true);
  });

  it('staged 为 true 时切换回工作区传 false', () => {
    const onToggleStaged = vi.fn();
    render(
      <DiffViewer
        versions={versions}
        staged={true}
        onToggleStaged={onToggleStaged}
        ignoreWhitespace={false}
        loader={stubLoader}
      />,
    );
    fireEvent.click(screen.getByText('工作区'));
    expect(onToggleStaged).toHaveBeenCalledWith(false);
  });
});
