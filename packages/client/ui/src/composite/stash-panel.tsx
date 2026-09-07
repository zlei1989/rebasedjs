/**
 * 贮藏面板（对照 Java GitStashDialog/GitUnstashAsDialog 的原子动作面）：
 *  顶部保存表单 Card（message Input + includeUntracked Checkbox + 保存按钮）；
 *  下方贮藏列表 Card（空态 EmptyState）：行 = stash@{index} 徽标 + message + 日期 + 操作
 *  （应用/弹出/转分支/Unstash As…/查看差异/删除——弹出与删除走 Popconfirm，转分支与 Unstash As 开 Modal）。
 *  Unstash As：目标分支 Select（本地分支，GitUnstashAsDialog 语义——检出目标分支 + apply 不 drop）；
 *  查看差异：Modal 展示 git stash show -p 的 unified 补丁（数据由容器条件拉取）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Checkbox, Flex, Input, Modal, Popconfirm, Select, Spin, Tag, Typography } from 'antd';
import type { BranchRef, StashAction, StashDiff, StashEntry, StashList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';

export interface StashPanelProps {
  stashes: StashList;
  onAction: (action: StashAction) => void;
  /** Unstash As 回调（index + 目标本地分支）；提供时行内渲染「Unstash As…」 */
  onUnstashAs?: (index: number, branch: string) => void;
  /** Unstash As 进行中 */
  unstashingAs?: boolean;
  /** 本地分支（Unstash As 目标选项；缺省渲染提示等待数据） */
  branches?: BranchRef[];
  /** 查看差异数据：点击行「查看差异」后由容器条件拉取（diffIndex 键控）；null 未拉取 */
  stashDiff?: StashDiff | null;
  diffLoading?: boolean;
  diffError?: string | null;
  /** 查看差异进行中 */
  diffActing?: boolean;
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

/** 贮藏行：stash@{index} 徽标 + message + 日期 + 操作（应用/弹出/转分支/Unstash As/查看差异/删除） */
function StashRow({
  stash,
  onAction,
  onBranch,
  onUnstashAs,
  onOpenDiff,
}: {
  stash: StashEntry;
  onAction: (action: StashAction) => void;
  onBranch: (stash: StashEntry) => void;
  onUnstashAs?: (stash: StashEntry) => void;
  onOpenDiff?: (stash: StashEntry) => void;
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
      {onUnstashAs !== undefined ? (
        <Button size="small" data-testid={`unstash-as-${stash.index}`} onClick={() => onUnstashAs(stash)}>
          Unstash As…
        </Button>
      ) : null}
      {onOpenDiff !== undefined ? (
        <Button size="small" data-testid={`stash-diff-${stash.index}`} onClick={() => onOpenDiff(stash)}>
          查看差异
        </Button>
      ) : null}
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

export function StashPanel({
  stashes,
  onAction,
  onUnstashAs,
  unstashingAs,
  branches,
  stashDiff,
  diffLoading,
  diffError,
  acting,
}: StashPanelProps): React.ReactNode {
  const [branchTarget, setBranchTarget] = useState<StashEntry | null>(null);
  const [unstashTarget, setUnstashTarget] = useState<StashEntry | null>(null);
  const [unstashBranch, setUnstashBranch] = useState<string | undefined>(undefined);
  const [diffIndex, setDiffIndex] = useState<number | null>(null);
  const localBranches = (branches ?? []).filter((b) => !b.remote);

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
                onUnstashAs={onUnstashAs === undefined ? undefined : setUnstashTarget}
                onOpenDiff={(stash) => setDiffIndex(stash.index)}
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
      {/* Unstash As Modal：目标分支 Select（本地分支）；确认后复位（分支选择保留——同类连续操作场景） */}
      <Modal
        title={`Unstash As：stash@{${unstashTarget === null ? '' : unstashTarget.index}}`}
        open={unstashTarget !== null}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: unstashBranch === undefined || unstashBranch === '' }}
        confirmLoading={unstashingAs}
        onOk={() => {
          if (unstashTarget !== null && unstashBranch !== undefined && unstashBranch !== '') {
            onUnstashAs?.(unstashTarget.index, unstashBranch);
          }
          setUnstashTarget(null);
        }}
        onCancel={() => setUnstashTarget(null)}
      >
        <Flex vertical gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将检出目标分支并应用该贮藏（贮藏保留，不弹出）
          </Typography.Text>
          <Select
            data-testid="unstash-as-branch"
            placeholder="选择本地分支"
            style={{ width: '100%' }}
            value={unstashBranch}
            options={localBranches.map((b) => ({ value: b.name, label: b.name }))}
            onChange={setUnstashBranch}
          />
        </Flex>
      </Modal>
      {/* 查看差异 Modal：git stash show -p 的 unified 补丁（数据由容器按 diffIndex 条件拉取） */}
      <Modal
        title={`贮藏差异：stash@{${diffIndex === null ? '' : diffIndex}}`}
        open={diffIndex !== null}
        footer={null}
        width={720}
        onCancel={() => setDiffIndex(null)}
      >
        {diffLoading ? (
          <Spin data-testid="stash-diff-loading" />
        ) : diffError !== undefined && diffError !== null ? (
          <Typography.Text type="danger" data-testid="stash-diff-error">
            {diffError}
          </Typography.Text>
        ) : stashDiff === null || stashDiff === undefined ? null : (
          <pre
            data-testid="stash-diff-text"
            style={{
              margin: 0,
              maxHeight: 480,
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'pre',
            }}
          >
            {stashDiff.patch}
          </pre>
        )}
      </Modal>
    </Flex>
  );
}
