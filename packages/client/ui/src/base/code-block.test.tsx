/**
 * 只读代码块测试：loader 注入 stub，避开真实高亮器（jsdom 里 monaco 的 clipboard 依赖与 shiki 的 wasm 都跑不起来）。
 * 断言重点在**接线**：语言与行元数据有没有正确交给高亮器、加载中/失败时是否退到纯文本、缓存是否命中一个 loader 实例。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeBlock, type CodeBlockLoader } from './code-block';
import { decoratePatchLines, type PatchLine } from '../domain/highlight';

/** 桩 loader：highlight 返回可辨认的标记 HTML，并记录每次调用参数（签名与 shiki-lazy 的 DefaultExport 一致：单个请求对象） */
function stubLoader(): { loader: CodeBlockLoader; highlight: ReturnType<typeof vi.fn> } {
  const highlight = vi.fn(async ({ code, language, lines }: { code: string; language: string; lines?: readonly PatchLine[] }) => {
    const count = lines?.length ?? code.split('\n').length;
    return `${language}|${count}|${code}`;
  });
  return { loader: (() => Promise.resolve({ highlight })) as CodeBlockLoader, highlight };
}

describe('CodeBlock', () => {
  it('loader 就绪后展示高亮结果，并把 code/language/行元数据交给高亮器', async () => {
    const { loader, highlight } = stubLoader();
    render(
      <CodeBlock
        code={'@@ -1 +1 @@\n+new\n'}
        language="diff"
        plainLines={[
          { kind: 'hunk', content: '@@ -1 +1 @@' },
          { kind: 'add', content: '+new' },
        ]}
        loader={loader}
      />,
    );
    expect(await screen.findByTestId('code-block-highlighted')).toHaveTextContent('diff|2|@@ -1 +1 @@');
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('未提供 loader 时直接渲染纯文本（不加载任何高亮器）', () => {
    render(<CodeBlock code="const a = 1;" language="typescript" />);
    expect(screen.getByTestId('code-block-plain')).toHaveTextContent('const a = 1;');
    expect(screen.queryByTestId('code-block-highlighted')).not.toBeInTheDocument();
  });

  it('loading 或 error 时不渲染高亮结果，退到纯文本', async () => {
    const loading: CodeBlockLoader = () => new Promise(() => {});
    const { rerender } = render(<CodeBlock code="x" language="diff" loader={loading} />);
    expect(screen.getByTestId('code-block-plain')).toHaveTextContent('x');
    expect(screen.queryByTestId('code-block-highlighted')).not.toBeInTheDocument();

    const failing: CodeBlockLoader = () => Promise.reject(new Error('grammar 加载失败'));
    rerender(<CodeBlock code="x" language="diff" loader={failing} />);
    expect(screen.getByTestId('code-block-plain')).toHaveTextContent('x');
    expect(screen.queryByTestId('code-block-highlighted')).not.toBeInTheDocument();
  });

  it('同一 loader 实例内 code/language 相同则复用高亮结果', async () => {
    const { loader, highlight } = stubLoader();
    const { rerender } = render(<CodeBlock code="x" language="diff" loader={loader} />);
    await screen.findByTestId('code-block-highlighted');
    rerender(<CodeBlock code="x" language="diff" loader={loader} />);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('换 loader 实例后重新高亮（缓存按 loader 实例隔离）', async () => {
    const a = stubLoader();
    const { rerender } = render(<CodeBlock code="x" language="diff" loader={a.loader} />);
    await screen.findByTestId('code-block-highlighted');

    const b = stubLoader();
    rerender(<CodeBlock code="x" language="diff" loader={b.loader} />);
    await screen.findByTestId('code-block-highlighted');
    expect(b.highlight).toHaveBeenCalledTimes(1);
  });

  it('带行元数据时纯文本回退逐行挂 data-kind（高亮未就绪的那一瞬间样式不丢）', () => {
    const lines: PatchLine[] = [
      { kind: 'hunk', content: '@@ -1 +1 @@' },
      { kind: 'add', content: '+new' },
      { kind: 'remove', content: '-old' },
    ];
    const { container } = render(<CodeBlock code={'@@ -1 +1 @@\n+new\n-old'} language="diff" plainLines={lines} />);
    const kinds = [...container.querySelectorAll('[data-kind]')].map((el) => el.getAttribute('data-kind'));
    expect(kinds).toEqual(['hunk', 'add', 'remove']);
  });

  it('行之间不夹文本节点（否则 pre 会多渲染出空行）', () => {
    const lines: PatchLine[] = decoratePatchLines('@@ -1 +1 @@\n+new\n-old\n');
    const { container } = render(<CodeBlock code={'@@ -1 +1 @@\n+new\n-old\n'} language="diff" plainLines={lines} />);
    const pre = container.querySelector('[data-testid="code-block-plain"]');
    expect(pre?.textContent).toBe('@@ -1 +1 @@+new-old');
    expect(pre?.childNodes).toHaveLength(3);
  });

  it('maxHeight 落到滚动外壳上（长补丁在容器内滚动，不撑开卡片）', () => {
    const { container } = render(<CodeBlock code="x" language="diff" maxHeight={240} />);
    const shell = container.querySelector('[data-testid="code-block-plain"]')?.parentElement;
    expect(shell).toHaveStyle({ maxHeight: '240px', overflow: 'auto' });
  });
});
