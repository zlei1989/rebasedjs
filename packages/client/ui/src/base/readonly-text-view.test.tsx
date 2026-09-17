import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReadonlyTextActions, ReadonlyTextView } from './readonly-text-view';
import type { MonacoEditorInnerProps, MonacoLazyLoader } from './monaco-lazy';

/** 剪贴板桩：返回 writeText 供断言 */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('ReadonlyTextView', () => {
  /** Monaco 桩：把收到的 props 落成可断言的 DOM（真实编辑器在 jsdom 里起不来） */
  const seen: MonacoEditorInnerProps[] = [];
  const stubLoader: MonacoLazyLoader = () =>
    Promise.resolve({
      default: (props) => {
        const inner = props as MonacoEditorInnerProps;
        seen.push(inner);
        return (
          <div
            data-testid="monaco-stub"
            data-language={String(inner.language)}
            data-readonly={String(inner.readOnly)}
            data-value={String(inner.value)}
          />
        );
      },
    });

  it('未选文件时给空态，不渲染编辑器', () => {
    render(<ReadonlyTextView />);
    expect(screen.getByText('在左侧选择文件查看内容')).toBeInTheDocument();
    expect(screen.queryByTestId('browse-code-editor')).not.toBeInTheDocument();
  });

  it('内容就绪时交给 Monaco：值、语言、只读三样都对', async () => {
    seen.length = 0;
    render(<ReadonlyTextView path="src/a.ts" content={'const a = 1;'} loader={stubLoader} />);
    const stub = await screen.findByTestId('monaco-stub');
    // 语言按扩展名推断（domain/language），只读恒定打开
    expect(stub).toHaveAttribute('data-language', 'typescript');
    expect(stub).toHaveAttribute('data-readonly', 'true');
    expect(seen[0]?.value).toBe('const a = 1;');
  });

  it('语言按文件扩展名推断；推不出时退回 plaintext；可被 language 覆盖', async () => {
    const { unmount } = render(<ReadonlyTextView path="bin/start.sh" content="echo 1" loader={stubLoader} />);
    expect(await screen.findByTestId('monaco-stub')).toHaveAttribute('data-language', 'shell');
    unmount();
    const second = render(<ReadonlyTextView path="Makefile" content="all:" loader={stubLoader} />);
    expect(await screen.findByTestId('monaco-stub')).toHaveAttribute('data-language', 'plaintext');
    second.unmount();
    render(<ReadonlyTextView path="Makefile" content="all:" language="makefile" loader={stubLoader} />);
    expect(await screen.findByTestId('monaco-stub')).toHaveAttribute('data-language', 'makefile');
  });

  it('编辑器宿主自适应可见高度（flex:1 + minHeight:0，不按内容撑开）', async () => {
    render(<ReadonlyTextView path="src/a.ts" content={'x'.repeat(200)} loader={stubLoader} />);
    const host = screen.getByTestId('browse-code-editor');
    expect(host.style.flex).toBe('1 1 0%');
    expect(host.style.minHeight).toBe('0px');
  });

  it('二进制文件只提示不渲染编辑器', () => {
    render(<ReadonlyTextView path="bin/a" content="" binary loader={stubLoader} />);
    expect(screen.getByTestId('browse-binary')).toBeInTheDocument();
    expect(screen.queryByTestId('browse-code-editor')).not.toBeInTheDocument();
  });

  it('加载中与错误态各有占位（沿用既有锚点，避免新旧两套 testid）', () => {
    const { unmount } = render(<ReadonlyTextView path="src/a.ts" content="x" loading loader={stubLoader} />);
    expect(screen.getByTestId('browse-content-loading')).toBeInTheDocument();
    unmount();
    render(<ReadonlyTextView path="src/a.ts" content="x" error="读不出来" loader={stubLoader} />);
    expect(screen.getByTestId('browse-content-error')).toHaveTextContent('读不出来');
  });

  it('copyHint 由调用方给（按钮在通栏、文案在正文区，状态归调用方）', () => {
    const { unmount } = render(<ReadonlyTextView path="src/a.ts" content="x" loader={stubLoader} />);
    expect(screen.queryByTestId('browse-copy-hint')).not.toBeInTheDocument();
    unmount();
    render(<ReadonlyTextView path="src/a.ts" content="x" copyHint="已复制全文" loader={stubLoader} />);
    expect(screen.getByTestId('browse-copy-hint')).toHaveTextContent('已复制全文');
  });
});

describe('ReadonlyTextActions（通栏右侧的动作按钮）', () => {
  /** 剪贴板桩：返回 writeText 供断言 */
  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it('内容就绪时复制全文可点，点击回调由调用方处理写剪贴板', () => {
    const onCopyAll = vi.fn();
    render(<ReadonlyTextActions content={'a\nb'} onCopyAll={onCopyAll} />);
    fireEvent.click(screen.getByTestId('browse-copy-all'));
    expect(onCopyAll).toHaveBeenCalledTimes(1);
  });

  it('内容未就绪或二进制时复制全文禁用（没有可复制的正文）', () => {
    const { unmount } = render(<ReadonlyTextActions onCopyAll={() => {}} />);
    expect(screen.getByTestId('browse-copy-all')).toBeDisabled();
    unmount();
    render(<ReadonlyTextActions content="" binary onCopyAll={() => {}} />);
    expect(screen.getByTestId('browse-copy-all')).toBeDisabled();
  });

  it('只提供复制全文一个动作：「在新标签页打开」（导出图标）按钮已删除', () => {
    render(<ReadonlyTextActions content="x" onCopyAll={() => {}} />);
    expect(screen.getByTestId('browse-copy-all')).toBeInTheDocument();
    expect(screen.queryByTestId('browse-open-tab')).not.toBeInTheDocument();
  });

  it('剪贴板写入由调用方完成：本组件不含写剪贴板的副作用', async () => {
    const writeText = stubClipboard();
    render(<ReadonlyTextActions content={'a\nb'} />);
    fireEvent.click(screen.getByTestId('browse-copy-all'));
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
  });
});
