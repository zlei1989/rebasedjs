import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileVersions } from '@rebased/contracts';
import type { MonacoDiffInnerProps } from '../base/monaco-diff-view';
import { DiffViewer } from './diff-viewer';

const versions: FileVersions = { before: '旧内容', after: '新内容' };

/** 注入 stub loader，绕过真实 monaco 加载 */
const stubLoader = (): Promise<{ default: () => React.ReactNode }> =>
  Promise.resolve({ default: () => <div>stub-diff-editor</div> });

/** 记录编辑器收到 props 的 stub loader（用于断言 options 透传：换行 / 未变更区折叠） */
function captureLoader(
  sink: Array<MonacoDiffInnerProps>,
): () => Promise<{ default: (props: MonacoDiffInnerProps) => React.ReactNode }> {
  return () =>
    Promise.resolve({
      default: (props: MonacoDiffInnerProps) => {
        sink.push(props);
        return <div>stub-diff-editor</div>;
      },
    });
}

describe('DiffViewer', () => {
  // 工具条各项是**逐项落 localStorage** 的偏好：每个用例从干净的本机偏好起步，避免上一条串到下一条
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('模式切换按钮存在，默认并排', async () => {
    render(<DiffViewer versions={versions} staged={false} loader={stubLoader} />);
    expect(screen.getByText('并排')).toBeInTheDocument();
    expect(screen.getByText('行内')).toBeInTheDocument();
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
  });

  it('点击「行内」切换 diff 呈现模式', async () => {
    render(<DiffViewer versions={versions} staged={false} loader={stubLoader} />);
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
        loader={stubLoader}
      />,
    );
    fireEvent.click(screen.getByText('已暂存'));
    expect(onToggleStaged).toHaveBeenCalledWith(true);
  });

  it('忽略空白是自有状态（显示选项）：点击即切换，不再上抛回调', () => {
    render(<DiffViewer versions={versions} staged={false} loader={stubLoader} />);
    const toggle = screen.getByTestId('diff-ignore-ws');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });

  it('staged 为 true 时切换回工作区传 false', () => {
    const onToggleStaged = vi.fn();
    render(
      <DiffViewer
        versions={versions}
        staged={true}
        onToggleStaged={onToggleStaged}
        loader={stubLoader}
      />,
    );
    fireEvent.click(screen.getByText('工作区'));
    expect(onToggleStaged).toHaveBeenCalledWith(false);
  });

  it('fromTo 模式隐藏 staged/工作区切换（与 from/to 互斥，服务端 400——终审 Must-fix 3）', () => {
    render(
      <DiffViewer
        versions={versions}
        staged={false}
        fromTo
        loader={stubLoader}
      />,
    );
    expect(screen.queryByText('工作区')).not.toBeInTheDocument();
    expect(screen.queryByText('已暂存')).not.toBeInTheDocument();
    expect(screen.getByText('并排')).toBeInTheDocument();
  });

  it('呈现选项渲染：空白字符 Select / 上下文行数 Select（默认 5 行）；「折叠」勾选框已删除', () => {
    render(<DiffViewer versions={versions} staged={false} loader={stubLoader} />);
    expect(screen.getByTestId('diff-whitespace')).toHaveTextContent('空白不显示');
    expect(screen.getByTestId('diff-context')).toHaveTextContent('上下文 5 行');
    expect(screen.getByTestId('diff-wrap')).toBeInTheDocument();
    /* 用户口径（2026-09-16）：Monaco 的 folding 是**代码折叠**，与差异编辑器的「未变更区折叠」不是一回事；
       本仓没有折叠区提供者（语言服务被关），实测勾选前后画面完全一样 ⇒ 删掉这个死控件。
       未变更区折叠由「上下文行数」独占表达。 */
    expect(screen.queryByTestId('diff-folding')).not.toBeInTheDocument();
    expect(screen.queryByText('折叠')).not.toBeInTheDocument();
    expect(screen.getByText(/word diff \/ 同步滚动为 Monaco 内建/)).toBeInTheDocument();
  });

  it('自动换行开关：默认关（wordWrap:off），打开后下发 wordWrap:on', async () => {
    const sink: MonacoDiffInnerProps[] = [];
    render(
      <DiffViewer versions={versions} staged={false} loader={captureLoader(sink)} />,
    );
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
    expect(sink.at(-1)?.options?.wordWrap).toBe('off');
    fireEvent.click(screen.getByTestId('diff-wrap'));
    // 选项变更靠 key 强制重挂载生效（monaco-lazy 只在 language 变化时重建编辑器）；
    // 重挂载经 Suspense 落地，故断言要等新的一轮 props 推进 sink
    await waitFor(() => expect(sink.at(-1)?.options?.wordWrap).toBe('on'));
  });

  it('未变更区折叠由「上下文行数」表达：默认下发 5 行，「全部显示」不下发；且永不下发 folding', async () => {
    const sink: MonacoDiffInnerProps[] = [];
    render(
      <DiffViewer versions={versions} staged={false} loader={captureLoader(sink)} />,
    );
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
    expect(sink.at(-1)?.options?.hideUnchangedRegions).toEqual({ enabled: true, contextLineCount: 5 });
    // folding（代码折叠）：本仓不渲染折叠槽（语言服务被关，无折叠区提供者），发了也是死选项——不再下发
    expect(sink.at(-1)?.options?.folding).toBeUndefined();
    fireEvent.mouseDown(screen.getByTestId('diff-context'));
    fireEvent.click(await screen.findByText('全部显示'));
    // 「全部显示」= 整文件展开（实测此时页面上的隐藏块 8 → 0）
    await waitFor(() => expect(sink.at(-1)?.options?.hideUnchangedRegions).toBeUndefined());
  });

  it('工具条每一项各落一个 localStorage 键：改动即写回，本机留最后一次要求', () => {
    render(<DiffViewer versions={versions} staged={false} loader={stubLoader} />);
    fireEvent.click(screen.getByText('行内'));
    fireEvent.click(screen.getByTestId('diff-ignore-ws'));
    fireEvent.click(screen.getByTestId('diff-wrap'));
    fireEvent.mouseDown(screen.getByTestId('diff-whitespace'));
    fireEvent.click(screen.getByText('空白显示'));
    expect(window.localStorage.getItem('rebased.diff.sideBySide')).toBe('false');
    expect(window.localStorage.getItem('rebased.diff.ignoreWhitespace')).toBe('true');
    expect(window.localStorage.getItem('rebased.diff.autoWrap')).toBe('true');
    expect(window.localStorage.getItem('rebased.diff.renderWhitespace')).toBe('all');
    // 默认 5 行：没动过的项不入库（只记「用户要求过」的项，不写一堆默认值）
    expect(window.localStorage.getItem('rebased.diff.contextLines')).toBeNull();
  });

  it('新开标签页（重新挂载）读回最后一次要求：五项逐项还原', async () => {
    window.localStorage.setItem('rebased.diff.sideBySide', 'false');
    window.localStorage.setItem('rebased.diff.ignoreWhitespace', 'true');
    window.localStorage.setItem('rebased.diff.autoWrap', 'true');
    window.localStorage.setItem('rebased.diff.renderWhitespace', 'all');
    window.localStorage.setItem('rebased.diff.contextLines', '15');
    const sink: MonacoDiffInnerProps[] = [];
    render(<DiffViewer versions={versions} staged={false} loader={captureLoader(sink)} />);
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
    expect(sink.at(-1)?.options?.renderSideBySide).toBe(false);
    expect(sink.at(-1)?.options?.ignoreTrimWhitespace).toBe(true);
    expect(sink.at(-1)?.options?.wordWrap).toBe('on');
    expect(sink.at(-1)?.options?.renderWhitespace).toBe('all');
    expect(sink.at(-1)?.options?.hideUnchangedRegions).toEqual({ enabled: true, contextLineCount: 15 });
    // 控件本身也呈现存下来的选择（不是「数据对了但开关还停在默认」）
    expect(screen.getByTestId('diff-ignore-ws')).toBeChecked();
    expect(screen.getByTestId('diff-wrap')).toBeChecked();
    expect(screen.getByTestId('diff-whitespace')).toHaveTextContent('空白显示');
    expect(screen.getByTestId('diff-context')).toHaveTextContent('上下文 15 行');
  });

  it('initialSideBySide 只作「没存过」时的初值：存过则以本机偏好为准（窄宿主不覆盖用户选择）', async () => {
    const sink: MonacoDiffInnerProps[] = [];
    const first = render(
      <DiffViewer versions={versions} staged={false} initialSideBySide={false} loader={captureLoader(sink)} />,
    );
    expect(await screen.findByText('stub-diff-editor')).toBeInTheDocument();
    expect(sink.at(-1)?.options?.renderSideBySide).toBe(false);
    // 用户显式切回并排 → 记进本机
    fireEvent.click(screen.getByText('并排'));
    expect(window.localStorage.getItem('rebased.diff.sideBySide')).toBe('true');
    first.unmount();
    // 新标签页：同一个窄宿主给的初值仍是 false，但本机偏好优先
    render(<DiffViewer versions={versions} staged={false} initialSideBySide={false} loader={captureLoader(sink)} />);
    await waitFor(() => expect(sink.at(-1)?.options?.renderSideBySide).toBe(true));
  });

  it('存量值坏掉（旧版本格式/手改）不炸页面：逐项回落默认', () => {
    window.localStorage.setItem('rebased.diff.contextLines', 'lots');
    window.localStorage.setItem('rebased.diff.sideBySide', 'maybe');
    render(<DiffViewer versions={versions} staged={false} loader={stubLoader} />);
    expect(screen.getByTestId('diff-context')).toHaveTextContent('上下文 5 行');
    expect(screen.getByText('并排')).toBeInTheDocument();
  });
});
