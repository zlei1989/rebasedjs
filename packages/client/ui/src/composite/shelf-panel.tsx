/**
 * 搁置面板：顶部「保存」按钮开 Modal（name 必填，确认提交 {action:"save",name}）；
 *  下方搁置列表 Card（空态 EmptyState）：行 = name + 创建时间 + "N 个未跟踪" + 操作
 *  （恢复 / 删除——均经 Popconfirm 确认：恢复会向工作区回放变更，误触成本高，同 pop/drop 确认约定）。
 *  恢复提交 {action:"restore",name}、删除 {action:"drop",name}。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ShelfAction, ShelfEntry, ShelfList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface ShelfPanelProps {
  shelves: ShelfList;
  onAction: (action: ShelfAction) => void;
  acting?: boolean;
}

/** 搁置行：name + 创建时间 + 未跟踪数 + 恢复/删除（均 Popconfirm，确认后以对应 action 回调） */
function ShelfRow({
  shelf,
  acting,
  onAction,
}: {
  shelf: ShelfEntry;
  acting?: boolean;
  onAction: (action: ShelfAction) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-shelf-${shelf.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {shelf.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(shelf.createdAtIso)}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {shelf.untrackedCount} 个未跟踪
      </Typography.Text>
      <Popconfirm
        title={`确定恢复搁置 ${shelf.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'restore', name: shelf.name })}
      >
        <Button size="small" data-testid={`restore-shelf-${shelf.name}`} disabled={acting}>
          恢复
        </Button>
      </Popconfirm>
      <Popconfirm
        title={`确定删除搁置 ${shelf.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'drop', name: shelf.name })}
      >
        <Button size="small" danger data-testid={`delete-shelf-${shelf.name}`} disabled={acting}>
          删除
        </Button>
      </Popconfirm>
    </Flex>
  );
}

/** 保存搁置 Modal：name 必填（空则确定禁用），确认提交 {action:"save",name}；关闭时复位 */
function SaveShelfModal({
  open,
  acting,
  onAction,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onAction: (action: ShelfAction) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');

  /** 关闭时清空输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setName('');
    onClose();
  };

  const submit = (): void => {
    onAction({ action: 'save', name: name.trim() });
    close();
  };

  return (
    <Modal
      title="保存搁置"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Input
        data-testid="shelf-save-name"
        placeholder="搁置名（必填）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </Modal>
  );
}

export function ShelfPanel({ shelves, onAction, acting }: ShelfPanelProps): React.ReactNode {
  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Flex>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          data-testid="shelf-save-button"
          loading={acting}
          onClick={() => setSaveOpen(true)}
        >
          保存
        </Button>
      </Flex>
      <Card size="small" title={`搁置列表（${shelves.shelves.length}）`}>
        {shelves.shelves.length === 0 ? (
          <EmptyState title="暂无搁置" />
        ) : (
          <Flex vertical>
            {shelves.shelves.map((shelf) => (
              <ShelfRow key={shelf.name} shelf={shelf} acting={acting} onAction={onAction} />
            ))}
          </Flex>
        )}
      </Card>
      <SaveShelfModal
        open={saveOpen}
        acting={acting}
        onAction={onAction}
        onClose={() => setSaveOpen(false)}
      />
    </Flex>
  );
}
