import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffStreamView } from './diff-stream-view';
import type { MonacoLazyLoader } from '../base/monaco-lazy';

/** 测试 stub loader：捕获 props 断言 + 渲染色值文本 */
function makeStubLoader() {
  const seen: { value: string; language?: string; readOnly?: boolean }[] = [];
  const loader: MonacoLazyLoader = async () => ({
    default: (props) => {
      const inner = props as { value: string; language?: string; readOnly?: boolean };
      seen.push(inner);
      return <div data-testid="stub-editor">{inner.value}</div>;
    },
  });
  return { loader, seen };
}

describe('DiffStreamView', () => {
  it('把累积补丁文本渐进渲染进 Monaco 编辑器（language diff + readOnly）', async () => {
    const { loader, seen } = makeStubLoader();
    render(<DiffStreamView text={'@@ -1 +1 @@\n-old\n+new\n'} connected loader={loader} />);
    // 懒加载：stub loader 异步 resolve 后渲染
    expect(await screen.findByTestId('stub-editor')).toHaveTextContent('@@ -1 +1 @@');
    expect(seen[0]).toMatchObject({ value: '@@ -1 +1 @@\n-old\n+new\n', language: 'diff', readOnly: true });
  });

  it('流错误：优先呈现错误文案（testid diff-stream-error）', async () => {
    const { loader } = makeStubLoader();
    render(<DiffStreamView text="" error="git diff 失败" loader={loader} />);
    expect(await screen.findByTestId('diff-stream-error')).toHaveTextContent('git diff 失败');
  });

  it('未连接且无错误：提示分块加载中断', async () => {
    const { loader } = makeStubLoader();
    render(<DiffStreamView text="abc" connected={false} loader={loader} />);
    expect(screen.getByText('分块加载中断')).toBeInTheDocument();
  });
});
