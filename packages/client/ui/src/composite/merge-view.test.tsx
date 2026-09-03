/**
 * MergeView 测试：Monaco 重，沿用仓内"轻 mock"手法——loader 注入 stub 编辑器组件，
 * 按 props 形态打标（value=普通模式 / original+modified=diff 模式）并记录 props 做断言；
 * 编辑行为由 stub 收到的 onChange 直接驱动。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConflictContents } from '@rebased/contracts';
import type { MonacoLazyProps } from '../base/monaco-lazy';
import { MergeView } from './merge-view';

/** stub 编辑器收到的全部 props（按渲染次序追加，beforeEach 清空） */
let editorProps: Array<Record<string, unknown>>;

/** stub 编辑器：替代真实 monaco，渲染模式标记并记录 props */
function StubEditor(props: MonacoLazyProps): React.ReactNode {
  editorProps.push({ ...props });
  return <div data-testid={'value' in props ? 'plain-editor' : 'diff-editor'} />;
}

/** 注入 stub loader，绕过真实 monaco 加载 */
const stubLoader = (): Promise<{ default: typeof StubEditor }> => Promise.resolve({ default: StubEditor });

const CONTENTS: ConflictContents = {
  path: 'src/a.ts',
  base: 'base 内容',
  ours: 'ours 内容',
  theirs: 'theirs 内容',
};

beforeEach(() => {
  editorProps = [];
});

/** 底部「合并结果」编辑器 props：普通模式（value）且可编辑（带 onChange） */
function resultEditorProps(): Record<string, unknown> {
  const found = editorProps.filter((p) => 'value' in p && typeof p.onChange === 'function');
  expect(found.length).toBeGreaterThan(0);
  return found[found.length - 1];
}

describe('MergeView', () => {
  it('渲染三标题：当前分支 / 合并来源 / 合并结果', async () => {
    render(<MergeView contents={CONTENTS} onSave={vi.fn()} loader={stubLoader} />);
    expect(screen.getByText('当前分支')).toBeInTheDocument();
    expect(screen.getByText('合并来源')).toBeInTheDocument();
    expect(screen.getByText('合并结果')).toBeInTheDocument();
    // 标题之外上排两个 diff 编辑器也应就位（等待懒加载完成）
    await waitFor(() => expect(screen.getAllByTestId('diff-editor')).toHaveLength(2));
  });

  it('base 非空时上排为两个只读 diff：base→ours、base→theirs', async () => {
    render(<MergeView contents={CONTENTS} onSave={vi.fn()} loader={stubLoader} />);
    await waitFor(() => expect(screen.getAllByTestId('diff-editor')).toHaveLength(2));
    const diffs = editorProps.filter((p) => !('value' in p));
    expect(diffs).toHaveLength(2);
    expect(diffs[0]).toMatchObject({ original: 'base 内容', modified: 'ours 内容' });
    expect(diffs[1]).toMatchObject({ original: 'base 内容', modified: 'theirs 内容' });
    for (const d of diffs) {
      expect((d.options as { readOnly?: boolean }).readOnly).toBe(true);
    }
  });

  it('合并结果编辑器初始内容为 ours ?? base ?? theirs ?? 空串', async () => {
    render(<MergeView contents={CONTENTS} onSave={vi.fn()} loader={stubLoader} />);
    await screen.findByTestId('plain-editor');
    expect(resultEditorProps().value).toBe('ours 内容');
  });

  it('ours 为 null 时合并结果初始内容回退为 base', async () => {
    render(<MergeView contents={{ ...CONTENTS, ours: null }} onSave={vi.fn()} loader={stubLoader} />);
    await screen.findByTestId('plain-editor');
    expect(resultEditorProps().value).toBe('base 内容');
  });

  it('保存按钮把编辑后的内容经 onSave 传出（编辑器 onChange 驱动）', async () => {
    const onSave = vi.fn();
    render(<MergeView contents={CONTENTS} onSave={onSave} loader={stubLoader} />);
    await screen.findByTestId('plain-editor');
    // mock 编辑器 onChange 直接驱动编辑内容
    act(() => {
      (resultEditorProps().onChange as (value: string) => void)('手工合并后的内容');
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    expect(onSave).toHaveBeenCalledWith('src/a.ts', '手工合并后的内容');
  });

  it('未编辑时保存传出初始内容', async () => {
    const onSave = vi.fn();
    render(<MergeView contents={CONTENTS} onSave={onSave} loader={stubLoader} />);
    await screen.findByTestId('plain-editor');
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    expect(onSave).toHaveBeenCalledWith('src/a.ts', 'ours 内容');
  });

  it('base 为 null（双方新增）时上排退化为 ours/theirs 两栏只读普通编辑器', async () => {
    render(
      <MergeView
        contents={{ path: 'new.txt', base: null, ours: '我方新增', theirs: '对方新增' }}
        onSave={vi.fn()}
        loader={stubLoader}
      />,
    );
    // 两栏只读 + 底部可编辑共 3 个普通编辑器，且无 diff 编辑器
    await waitFor(() => expect(screen.getAllByTestId('plain-editor')).toHaveLength(3));
    expect(screen.queryByTestId('diff-editor')).not.toBeInTheDocument();
    const readOnlyPanes = editorProps.filter((p) => 'value' in p && p.readOnly === true);
    expect(readOnlyPanes).toHaveLength(2);
    expect(readOnlyPanes.map((p) => p.value)).toEqual(['我方新增', '对方新增']);
  });

  it('saving 时保存按钮进入 loading 态', () => {
    render(<MergeView contents={CONTENTS} onSave={vi.fn()} saving loader={stubLoader} />);
    // antd 两字中文按钮自动插空格（"保 存"），用正则匹配
    expect(screen.getByRole('button', { name: /保\s*存/ }).className).toContain('ant-btn-loading');
  });
});
