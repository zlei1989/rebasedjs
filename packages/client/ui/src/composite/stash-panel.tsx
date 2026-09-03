/**
 * 贮藏面板（对照 Java GitStashDialog/GitUnstashAsDialog 的原子动作面）：
 *  顶部保存表单 Card（message Input + includeUntracked Checkbox + 保存按钮）；
 *  下方贮藏列表 Card（空态 EmptyState）：行 = stash@{index} 徽标 + message + 日期 + 操作
 *  （应用/弹出/转分支/删除——弹出与删除走 Popconfirm，转分支开 Modal 输入分支名）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Checkbox, Flex, Input, Modal, Popconfirm, Tag, Typography } from 'antd';
import type { StashAction, StashEntry, StashList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';

export interface StashPanelProps {
  stashes: StashList;
  onAction: (action: StashAction) => void;
  acting?: boolean;
}

/** 日期展示：format.ts 无相对时间助手，按 brief 退化为简单 toLocaleString（勿新造轮子） */
function formatStashDate(dateIso: string): string {
  const d = new Date(dateIso);
  return Number.isNaN(d.getTime()) ? dateIso : d.toLocaleString();
}

/** 保存表单 Card：message 输入 + 含未跟踪文件勾选 + 保存按钮；提交后复位输入 */
function SaveForm({ acting, onAction }: { acting?: boolean; onAction: (action: StashAction) => void }): React.ReactNode {
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);

  /** 提交：message 去除首尾空白后仅非空时携带（契约 save.message 为 optional） */
  const submit = (): void => {
    const trimmed = message.trim();
    onAction({
      action: 'save',
      ...(trimmed === '' ? {} : { message: trimmed }),
      includeUntracked,
    });
    setMessage('');
    setIncludeUntracked(false);
  };

  return (
    <Card size="small" title="保存贮藏">
      <Flex gap={8} align="center" wrap>
        <Input
          data-testid="stash-message-input"
          placeholder="贮藏说明（可空）"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <Checkbox
          checked={includeUntracked}
          onChange={(e) => setIncludeUntracked(e.target.checked)}
        >
          包含未跟踪文件
        </Checkbox>
        <Button
          type="primary"
          data-testid="stash-save-button"
          loading={acting}
          onClick={submit}
        >
          保存
        </Button>
      </Flex>
    </Card>
  );
}

/** 贮藏行：stash@{index} 徽标 + message + 日期 + 操作（应用/弹出/转分支/删除） */
function StashRow({
  stash,
  onAction,
  onBranch,
}: {
  stash: StashEntry;
  onAction: (action: StashAction) => void;
  onBranch: (stash: StashEntry) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-stash-${stash.index}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Tag>stash@{`{${stash.index}}`}</Tag>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {stash.message}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {formatStashDate(stash.dateIso)}
      </Typography.Text>
      <Button size="small" data-testid={`apply-stash-${stash.index}`} onClick={() => onAction({ action: 'apply', index: stash.index })}>
        应用
      </Button>
      <Popconfirm
        title={`确定弹出 stash@{${stash.index}}？弹出后将移除该贮藏`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'pop', index: stash.index })}
      >
        <Button size="small" data-testid={`pop-stash-${stash.index}`}>
          弹出
        </Button>
      </Popconfirm>
      <Button size="small" data-testid={`branch-stash-${stash.index}`} onClick={() => onBranch(stash)}>
        转分支
      </Button>
      <Popconfirm
        title={`确定删除 stash@{${stash.index}}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'drop', index: stash.index })}
      >
        <Button size="small" danger data-testid={`drop-stash-${stash.index}`}>
          删除
        </Button>
      </Popconfirm>
    </Flex>
  );
}

/** 转分支 Modal：单输入分支名；关闭时复位输入（Modal 默认不卸载子树，取消后重开不能残留上次输入） */
function BranchModal({
  target,
  acting,
  onAction,
  onClose,
}: {
  target: StashEntry | null;
  acting?: boolean;
  onAction: (action: StashAction) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');

  const close = (): void => {
    setName('');
    onClose();
  };

  const submit = (): void => {
    if (target !== null) onAction({ action: 'branch', index: target.index, name: name.trim() });
    close();
  };

  return (
    <Modal
      title={`贮藏转分支${target === null ? '' : `：stash@{${target.index}}`}`}
      open={target !== null}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Input
        data-testid="stash-branch-name-input"
        placeholder="新分支名"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </Modal>
  );
}

export function StashPanel({ stashes, onAction, acting }: StashPanelProps): React.ReactNode {
  const [branchTarget, setBranchTarget] = useState<StashEntry | null>(null);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <SaveForm acting={acting} onAction={onAction} />
      <Card size="small" title={`贮藏列表（${stashes.stashes.length}）`}>
        {stashes.stashes.length === 0 ? (
          <EmptyState title="暂无贮藏" />
        ) : (
          <Flex vertical>
            {stashes.stashes.map((stash) => (
              <StashRow
                key={stash.hash}
                stash={stash}
                onAction={onAction}
                onBranch={setBranchTarget}
              />
            ))}
          </Flex>
        )}
      </Card>
      <BranchModal
        target={branchTarget}
        acting={acting}
        onAction={onAction}
        onClose={() => setBranchTarget(null)}
      />
    </Flex>
  );
}
