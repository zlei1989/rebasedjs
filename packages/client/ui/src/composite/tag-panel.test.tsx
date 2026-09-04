import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TagEntry, TagList } from '@rebased/contracts';
import { TagPanel } from './tag-panel';

/** 测试标签工厂：补全 TagEntry 必填字段，默认轻量、无 subject */
function makeTag(partial: Partial<TagEntry> & { name: string }): TagEntry {
  return { hash: 'abc123', subject: null, annotated: false, ...partial };
}

/** 测试列表工厂 */
function makeList(tags: TagEntry[]): TagList {
  return { tags };
}

describe('TagPanel 列表渲染', () => {
  it('渲染全部标签行：name + subject；附注标签带「附注」徽标', () => {
    render(
      <TagPanel
        tags={makeList([
          makeTag({ name: 'v1.0', subject: '发布 1.0', annotated: true }),
          makeTag({ name: 'v1.1', subject: '发布 1.1', annotated: true }),
        ])}
        onAction={() => {}}
      />,
    );
    const row = screen.getByTestId('tag-row-v1.0');
    expect(row).toHaveTextContent('v1.0');
    expect(row).toHaveTextContent('发布 1.0');
    expect(row).toHaveTextContent('附注');
    expect(screen.getByTestId('tag-row-v1.1')).toHaveTextContent('附注');
  });

  it('轻量标签（subject 为 null）：不渲染 subject 与「附注」徽标', () => {
    render(<TagPanel tags={makeList([makeTag({ name: 'light' })])} onAction={() => {}} />);
    const row = screen.getByTestId('tag-row-light');
    expect(row).toHaveTextContent('light');
    expect(row).not.toHaveTextContent('附注');
  });

  it('空标签列表：展示空态占位', () => {
    render(<TagPanel tags={makeList([])} onAction={() => {}} />);
    expect(screen.queryByTestId(/^tag-row-/)).not.toBeInTheDocument();
    expect(screen.getByText('暂无标签')).toBeInTheDocument();
  });
});

describe('TagPanel 创建标签 Modal', () => {
  it('仅填名称：轻量创建载荷 {action:"create", name}', async () => {
    const onAction = vi.fn();
    render(<TagPanel tags={makeList([])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('tag-create-button'));
    fireEvent.change(await screen.findByTestId('tag-create-name'), { target: { value: 'v2.0' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'create', name: 'v2.0' });
  });

  it('填写附注信息：载荷携带 message（附注标签）', async () => {
    const onAction = vi.fn();
    render(<TagPanel tags={makeList([])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('tag-create-button'));
    fireEvent.change(await screen.findByTestId('tag-create-name'), { target: { value: 'v2.0' } });
    fireEvent.change(screen.getByTestId('tag-create-message'), { target: { value: '发布说明：修复 X' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledWith({ action: 'create', name: 'v2.0', message: '发布说明：修复 X' });
  });

  it('填写 ref 与 message：载荷同时携带两者', async () => {
    const onAction = vi.fn();
    render(<TagPanel tags={makeList([])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('tag-create-button'));
    fireEvent.change(await screen.findByTestId('tag-create-name'), { target: { value: 'v2.0' } });
    fireEvent.change(screen.getByTestId('tag-create-ref'), { target: { value: 'main~1' } });
    fireEvent.change(screen.getByTestId('tag-create-message'), { target: { value: '附注消息' } });
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledWith({ action: 'create', name: 'v2.0', ref: 'main~1', message: '附注消息' });
  });

  it('名称为空时确定按钮禁用', async () => {
    render(<TagPanel tags={makeList([])} onAction={() => {}} />);
    fireEvent.click(screen.getByTestId('tag-create-button'));
    expect(await screen.findByRole('button', { name: /确\s*定/ })).toBeDisabled();
  });

  it('取消后重开：输入已复位', async () => {
    const onAction = vi.fn();
    render(<TagPanel tags={makeList([])} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('tag-create-button'));
    fireEvent.change(await screen.findByTestId('tag-create-name'), { target: { value: 'v2.0' } });
    fireEvent.change(await screen.findByTestId('tag-create-message'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    // Modal 默认不卸载子树：重开后不能残留上次输入（BranchPanel 教训）
    fireEvent.click(screen.getByTestId('tag-create-button'));
    expect(await screen.findByTestId('tag-create-name')).toHaveValue('');
    expect(screen.getByTestId('tag-create-message')).toHaveValue('');
  });
});

describe('TagPanel 行操作', () => {
  it('删除经 Popconfirm 确认后传 {action:"delete", name}', async () => {
    const onAction = vi.fn();
    render(<TagPanel tags={makeList([makeTag({ name: 'v1.0', annotated: true })] )} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('tag-delete-v1.0'));
    expect(await screen.findByText(/确定删除标签 v1.0/)).toBeInTheDocument();
    // antd Button 两个汉字间自动插空格（"确 定"），用正则匹配可访问名
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'delete', name: 'v1.0' });
  });

  it('推送经 Popconfirm 确认后传 {action:"push", name}', async () => {
    const onAction = vi.fn();
    render(<TagPanel tags={makeList([makeTag({ name: 'v1.0' })] )} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('tag-push-v1.0'));
    expect(await screen.findByText(/推送标签 v1.0 到远程仓库/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'push', name: 'v1.0' });
  });
});
