import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HunkDiffView } from './hunk-diff-view';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';

/** 测试 stub loader：捕获每个 MonacoDiffView 的 original/modified */
function makeStubLoader() {
  const seen: { original: string; modified: string }[] = [];
  const loader: MonacoDiffLoader = async () => ({
    default: (props) => {
      const inner = props as { original: string; modified: string };
      seen.push(inner);
      return <div data-testid="stub-diff">{inner.original}||{inner.modified}</div>;
    },
  });
  return { loader, seen };
}

const PATCH =
  'diff --git a/src/a.ts b/src/a.ts\nindex 111..222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n' +
  '@@ -1,5 +1,5 @@\n ctx 1\n-old 2\n+new 2\n ctx 3\n ctx 4\n ctx 5\n' +
  '@@ -10,3 +10,4 @@ fn bar()\n keep 10\n+add 11\n keep 12\n keep 13\n';

describe('HunkDiffView', () => {
  it('多 hunk 渲染：每 hunk 一个 MonacoDiffView（两侧剥离前缀）+ 绝对行号头行与上下文标题', async () => {
    const { loader, seen } = makeStubLoader();
    render(<HunkDiffView patch={PATCH} status="modified" loader={loader} />);
    expect(await screen.findAllByTestId('stub-diff')).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ original: 'ctx 1\nold 2\nctx 3\nctx 4\nctx 5\n', modified: 'ctx 1\nnew 2\nctx 3\nctx 4\nctx 5\n' });
    expect(seen[1]).toMatchObject({ original: 'keep 10\nkeep 12\nkeep 13\n', modified: 'keep 10\nadd 11\nkeep 12\nkeep 13\n' });
    expect(screen.getByText('@@ -1,5 +1,5 @@')).toBeInTheDocument();
    expect(screen.getByText('fn bar()')).toBeInTheDocument();
  });

  it('单 hunk 单块（块编号 0）', async () => {
    const { loader } = makeStubLoader();
    render(<HunkDiffView patch={'@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n'} status="modified" loader={loader} />);
    expect(await screen.findByTestId('hunk-diff-block-0')).toBeInTheDocument();
    expect(screen.queryByTestId('hunk-diff-block-1')).not.toBeInTheDocument();
  });

  it('0 hunk 降级：renamed → 仅重命名提示；其余 → 二进制/截断提示', async () => {
    const { loader } = makeStubLoader();
    const { unmount } = render(<HunkDiffView patch="" status="renamed" loader={loader} />);
    expect(screen.getByTestId('hunk-diff-degraded')).toHaveTextContent('仅重命名');
    unmount();
    render(<HunkDiffView patch="" status="modified" loader={loader} />);
    expect(screen.getByTestId('hunk-diff-degraded')).toHaveTextContent('二进制文件或超限截断');
  });
});
