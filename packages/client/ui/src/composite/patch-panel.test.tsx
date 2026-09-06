/**
 * PatchPanel 测试：列表渲染（name / size 字节格式 / formatCommitDate 创建时间）、空态、
 * 创建 Modal 三态载荷（工作区省略 staged / 暂存 staged:true / 提交区间 from·to 各自可空省略）、
 * 名称为空禁用确定、取消后重开复位、应用回调、删除 Popconfirm 确认后回调、acting 时行按钮禁用。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PatchEntry, PatchList } from '@rebased/contracts';
import { PatchPanel } from './patch-panel';

/** 测试补丁条目工厂：补全 PatchEntry 必填字段 */
function makePatch(partial: Partial<PatchEntry> & { name: string }): PatchEntry {
  return { size: 2048, createdAtIso: '2026-08-01T10:30:00+08:00', ...partial };
}

/** 测试列表工厂 */
function makeList(patches: PatchEntry[]): PatchList {
  return { patches };
}

/** 打开创建 Modal 并填入补丁名（名称为空时禁用，故各载荷用例先填名） */
async function openModalAndFillName(): Promise<void> {
  fireEvent.click(screen.getByTestId('patch-create-button'));
  fireEvent.change(await screen.findByTestId('patch-create-name'), { target: { value: 'wip-fix' } });
}

describe('PatchPanel 列表渲染', () => {
  it('行渲染 name、size 字节格式与创建时间', () => {
    render(
      <PatchPanel
        patches={makeList([
          makePatch({ name: 'wip-fix', size: 2048 }),
          makePatch({ name: 'feature-x', size: 5 * 1024 * 1024, createdAtIso: '2026-08-02T09:00:00+08:00' }),
        ])}
        onCreate={() => {}}
        onApply={() => {}}
        onDelete={() => {}}
      />,
    );
    const row = screen.getByTestId('row-patch-wip-fix');
    expect(row).toHaveTextContent('wip-fix');
    expect(row).toHaveTextContent('2.0 KB');
    expect(row).toHaveTextContent('2026-08-01 10:30');
    expect(screen.getByTestId('row-patch-feature-x')).toHaveTextContent('5.0 MB');
  });

  it('size 小于 1KB 显示字节数（N B）', () => {
    render(
      <PatchPanel
        patches={makeList([makePatch({ name: 'tiny', size: 512 })])}
        onCreate={() => {}}
        onApply={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByTestId('row-patch-tiny')).toHaveTextContent('512 B');
  });

  it('无补丁时渲染空态', () => {
    render(<PatchPanel patches={makeList([])} onCreate={() => {}} onApply={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('暂无补丁')).toBeInTheDocument();
  });
});

describe('PatchPanel 创建 Modal 三态载荷', () => {
  it('工作区（默认）：提交 {name}（省略 staged，服务端缺省视为 false）', async () => {
    const onCreate = vi.fn();
    render(<PatchPanel patches={makeList([])} onCreate={onCreate} onApply={() => {}} onDelete={() => {}} />);
    await openModalAndFillName();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({ name: 'wip-fix' });
  });

  it('暂存：提交 {name, staged:true}', async () => {
    const onCreate = vi.fn();
    render(<PatchPanel patches={makeList([])} onCreate={onCreate} onApply={() => {}} onDelete={() => {}} />);
    await openModalAndFillName();
    fireEvent.click(screen.getByRole('radio', { name: /暂存/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreate).toHaveBeenCalledWith({ name: 'wip-fix', staged: true });
  });

  it('提交区间（双侧）：提交 {name, from, to}', async () => {
    const onCreate = vi.fn();
    render(<PatchPanel patches={makeList([])} onCreate={onCreate} onApply={() => {}} onDelete={() => {}} />);
    await openModalAndFillName();
    fireEvent.click(screen.getByRole('radio', { name: /提交区间/ }));
    fireEvent.change(screen.getByTestId('patch-create-from'), { target: { value: 'main~3' } });
    fireEvent.change(screen.getByTestId('patch-create-to'), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreate).toHaveBeenCalledWith({ name: 'wip-fix', from: 'main~3', to: 'main' });
  });

  it('提交区间（单侧 from）：to 省略（服务端单侧缺省=HEAD）', async () => {
    const onCreate = vi.fn();
    render(<PatchPanel patches={makeList([])} onCreate={onCreate} onApply={() => {}} onDelete={() => {}} />);
    await openModalAndFillName();
    fireEvent.click(screen.getByRole('radio', { name: /提交区间/ }));
    fireEvent.change(screen.getByTestId('patch-create-from'), { target: { value: 'main~1' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onCreate).toHaveBeenCalledWith({ name: 'wip-fix', from: 'main~1' });
  });

  it('名称为空时确定按钮禁用', async () => {
    render(<PatchPanel patches={makeList([])} onCreate={() => {}} onApply={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByTestId('patch-create-button'));
    expect(await screen.findByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('取消后重开：输入与范围已复位', async () => {
    const onCreate = vi.fn();
    render(<PatchPanel patches={makeList([])} onCreate={onCreate} onApply={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByTestId('patch-create-button'));
    fireEvent.change(await screen.findByTestId('patch-create-name'), { target: { value: 'wip-fix' } });
    fireEvent.click(screen.getByRole('radio', { name: /提交区间/ }));
    fireEvent.change(screen.getByTestId('patch-create-from'), { target: { value: 'main~1' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(screen.getByTestId('patch-create-button'));
    expect(await screen.findByTestId('patch-create-name')).toHaveValue('');
    expect(screen.queryByTestId('patch-create-from')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /工作区/ })).toBeChecked();
  });
});

describe('PatchPanel 行操作', () => {
  it('「应用」：直接以 name 调 onApply', () => {
    const onApply = vi.fn();
    render(
      <PatchPanel
        patches={makeList([makePatch({ name: 'wip-fix' })])}
        onCreate={() => {}}
        onApply={onApply}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('apply-patch-wip-fix'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('wip-fix');
  });

  it('「删除」：Popconfirm 确认后以 name 调 onDelete', async () => {
    const onDelete = vi.fn();
    render(
      <PatchPanel
        patches={makeList([makePatch({ name: 'wip-fix' })])}
        onCreate={() => {}}
        onApply={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-patch-wip-fix'));
    expect(await screen.findByText(/确定删除补丁 wip-fix/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('wip-fix');
  });

  it('Popconfirm 取消不触发 onDelete', async () => {
    const onDelete = vi.fn();
    render(
      <PatchPanel
        patches={makeList([makePatch({ name: 'wip-fix' })])}
        onCreate={() => {}}
        onApply={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-patch-wip-fix'));
    fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('acting 时行内应用/删除按钮禁用', () => {
    render(
      <PatchPanel
        patches={makeList([makePatch({ name: 'wip-fix' })])}
        onCreate={() => {}}
        onApply={() => {}}
        onDelete={() => {}}
        acting
      />,
    );
    expect(screen.getByTestId('apply-patch-wip-fix')).toBeDisabled();
    expect(screen.getByTestId('delete-patch-wip-fix')).toBeDisabled();
  });
});
