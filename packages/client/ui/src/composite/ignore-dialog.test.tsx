/**
 * IgnoreDialog 测试：默认 target=gitignore（文本域展示 contents.gitignore）、target 切换随 contents 显示、
 * 模板选中即替换预览（可继续编辑）、提交载荷为当前文本域内容（无变化也允许提交——幂等）、
 * 取消/重开复位（内容回 contents 对应 target 的当前值，跟随最新 props）、confirming 时 loading 且禁用。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IgnoreContents, IgnoreTemplate } from '@rebased/contracts';
import { IgnoreDialog } from './ignore-dialog';

/** 两套忽略内容：验证复位跟随 props 当前值 */
const CONTENTS_A: IgnoreContents = { gitignore: '# 原 gitignore\nnode_modules/\n', exclude: '# 原 exclude\nlocal.tmp\n' };
const CONTENTS_B: IgnoreContents = { gitignore: '# 新 gitignore\ndist/\n', exclude: '# 新 exclude\nother.tmp\n' };

const TEMPLATES: IgnoreTemplate[] = [
  { id: 'node', name: 'Node.js', content: '# Node\nnode_modules/\ndist/\n' },
  { id: 'python', name: 'Python', content: '# Python\n__pycache__/\n' },
];

/** 打开模板下拉并点选指定模板（antd v6 Select：mouseDown .ant-select-content 展开、点击选项文本） */
async function pickTemplate(name: string): Promise<void> {
  const select = screen.getByTestId('ignore-template-select');
  fireEvent.mouseDown(select.querySelector('.ant-select-content')!);
  fireEvent.click(await screen.findByText(name));
}

/** 测试回调工厂 */
function makeHandlers() {
  return { onOk: vi.fn(), onCancel: vi.fn() };
}

describe('IgnoreDialog', () => {
  it('open=false 时不渲染对话框内容', () => {
    render(<IgnoreDialog open={false} contents={CONTENTS_A} templates={TEMPLATES} {...makeHandlers()} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('默认选中 .gitignore：文本域展示 contents.gitignore', () => {
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} {...makeHandlers()} />);
    expect(screen.getByRole('radio', { name: /gitignore/ })).toBeChecked();
    expect(screen.getByTestId('ignore-content')).toHaveValue(CONTENTS_A.gitignore);
  });

  it('target 切换：文本域随 target 显示 contents 对应内容（切回恢复）', () => {
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} {...makeHandlers()} />);
    fireEvent.click(screen.getByRole('radio', { name: /exclude/ }));
    expect(screen.getByTestId('ignore-content')).toHaveValue(CONTENTS_A.exclude);
    fireEvent.click(screen.getByRole('radio', { name: /gitignore/ }));
    expect(screen.getByTestId('ignore-content')).toHaveValue(CONTENTS_A.gitignore);
  });

  it('模板选中即替换预览：文本域变为模板 content', async () => {
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} {...makeHandlers()} />);
    await pickTemplate('Node.js');
    expect(screen.getByTestId('ignore-content')).toHaveValue('# Node\nnode_modules/\ndist/\n');
  });

  it('模板替换后可继续编辑：提交载荷为编辑后内容', async () => {
    const { onOk } = makeHandlers();
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} onOk={onOk} onCancel={() => {}} />);
    await pickTemplate('Python');
    fireEvent.change(screen.getByTestId('ignore-content'), { target: { value: '# 自定\nbuild/\n' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith('gitignore', '# 自定\nbuild/\n');
  });

  it('内容无变化也允许提交（幂等）：载荷为 contents 当前值', () => {
    const { onOk } = makeHandlers();
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith('gitignore', CONTENTS_A.gitignore);
  });

  it('切换 target 后提交携带对应 target 与内容', () => {
    const { onOk } = makeHandlers();
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} onOk={onOk} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /exclude/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onOk).toHaveBeenCalledWith('exclude', CONTENTS_A.exclude);
  });

  it('点取消触发 onCancel 且不触发 onOk', () => {
    const { onOk, onCancel } = makeHandlers();
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} onOk={onOk} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('取消后重开复位：target 回 gitignore、内容回 contents 对应 target 的当前值（跟随最新 props）', () => {
    const { onCancel } = makeHandlers();
    const { rerender } = render(
      <IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} onOk={() => {}} onCancel={onCancel} />,
    );
    fireEvent.change(screen.getByTestId('ignore-content'), { target: { value: '局部编辑' } });
    fireEvent.click(screen.getByRole('radio', { name: /exclude/ }));
    expect(screen.getByTestId('ignore-content')).toHaveValue(CONTENTS_A.exclude);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    // 父级关窗后重开（内容已刷新为 CONTENTS_B）：内部状态回到基线、内容带最新 props 值
    rerender(<IgnoreDialog open={false} contents={CONTENTS_A} templates={TEMPLATES} onOk={() => {}} onCancel={onCancel} />);
    rerender(<IgnoreDialog open contents={CONTENTS_B} templates={TEMPLATES} onOk={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('radio', { name: /gitignore/ })).toBeChecked();
    expect(screen.getByTestId('ignore-content')).toHaveValue(CONTENTS_B.gitignore);
  });

  it('confirming 时确定按钮进入 loading 态且禁用', () => {
    render(<IgnoreDialog open contents={CONTENTS_A} templates={TEMPLATES} confirming {...makeHandlers()} />);
    const ok = screen.getByRole('button', { name: /确\s*定/ });
    expect(ok).toHaveClass('ant-btn-loading');
    expect(ok).toBeDisabled();
  });
});
