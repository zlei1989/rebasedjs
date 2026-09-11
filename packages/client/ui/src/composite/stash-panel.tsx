/**
 * 贮藏面板（对照 Java GitStashDialog/GitUnstashAsDialog 的原子动作面）：
 *  顶部保存表单 Card（message Input + includeUntracked Checkbox + 保存按钮）；
 *  下方贮藏列表 Card（空态 EmptyState）：行 = stash@{index} 徽标 + message + 日期 + 操作
 *  （应用/弹出/转分支/Unstash As…/查看差异/删除——弹出与删除走 Popconfirm，转分支与 Unstash As 开 Modal）。
 *  Unstash As：目标分支 Select（本地分支，GitUnstashAsDialog 语义——检出目标分支 + apply 不 drop）；
 *  查看差异：Modal 展示 git stash show -p 的 unified 补丁（数据由容器条件拉取）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 *  所有可交互元素（输入/勾选/按钮/选择器）均一对一包 Tooltip，说明作用对象与后果。
 */
import { useState } from 'react';
import { Button, Card, Checkbox, Flex, Input, Modal, Popconfirm, Select, Spin, Tag, Tooltip, Typography } from 'antd';
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
  /** 当前查看差异的贮藏下标（容器持有：与拉取键同源，面板不再自持状态，避免「弹窗开了但没人拉数据」）；null/undefined 表示未打开 */
  diffIndex?: number | null;
  /** 查看差异回调（提供时行内渲染「查看差异」） */
  onOpenDiff?: (index: number) => void;
  /** 关闭查看差异 Modal */
  onCloseDiff?: () => void;
  acting?: boolean;
}

/** 日期展示：format.ts 无相对时间助手，按 brief 退化为简单 toLocaleString（勿新造轮子） */
function formatStashDate(dateIso: string): string {
  const d = new Date(dateIso);
  return Number.isNaN(d.getTime()) ? dateIso : d.toLocaleString();
}

/** 保存表单 Card：message 输入 + 含未跟踪文件/保持暂存区勾选 + 保存按钮；提交后复位输入 */
function SaveForm({ acting, onAction }: { acting?: boolean; onAction: (action: StashAction) => void }): React.ReactNode {
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [keepIndex, setKeepIndex] = useState(false);

  /** 提交：message 去除首尾空白后仅非空时携带（契约 save.message 为 optional）；提交后复位全部输入 */
  const submit = (): void => {
    const trimmed = message.trim();
    onAction({
      action: 'save',
      ...(trimmed === '' ? {} : { message: trimmed }),
      includeUntracked,
      ...(keepIndex ? { keepIndex: true } : {}),
    });
    setMessage('');
    setIncludeUntracked(false);
    setKeepIndex(false);
  };

  return (
    <Card size="small" title="保存贮藏">
      <Flex gap={8} align="center" wrap>
        <Tooltip title="贮藏说明：写入 stash message，留空则该贮藏以 WIP 命名">
          <Input
            data-testid="stash-message-input"
            placeholder="贮藏说明（可空）"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
        </Tooltip>
        <Tooltip title="勾选后把未跟踪的新文件一并存入贮藏（--include-untracked）">
          <Checkbox
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
          >
            包含未跟踪文件
          </Checkbox>
        </Tooltip>
        {/* keep-index（--keep-index）：贮藏后暂存区保持不动（工作区变更回退，索引内容留在暂存区） */}
        <Tooltip title="勾选后保留暂存区内容（--keep-index）：只回退工作区，已 add 的内容仍留在索引">
          <Checkbox
            data-testid="stash-keep-index"
            checked={keepIndex}
            onChange={(e) => setKeepIndex(e.target.checked)}
          >
            保持暂存区（keep-index）
          </Checkbox>
        </Tooltip>
        <Tooltip title="把当前工作区改动存为一个贮藏条目，随后工作区回到干净状态">
          <Button
            type="primary"
            data-testid="stash-save-button"
            loading={acting}
            onClick={submit}
          >
            保存
          </Button>
        </Tooltip>
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
      <Tooltip title="把该贮藏的变更应用到当前工作区，贮藏条目保留在列表里">
        <Button size="small" data-testid={`apply-stash-${stash.index}`} onClick={() => onAction({ action: 'apply', index: stash.index })}>
          应用
        </Button>
      </Tooltip>
      {/* Popconfirm 的触发按钮：Tooltip 必须放最内层，否则会截断 Popconfirm 的点击触发链 */}
      <Popconfirm
        title={`确定弹出 stash@{${stash.index}}？弹出后将移除该贮藏`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'pop', index: stash.index })}
      >
        <Tooltip title="应用该贮藏的变更并从列表移除（等价 git stash pop）">
          <Button size="small" data-testid={`pop-stash-${stash.index}`}>
            弹出
          </Button>
        </Tooltip>
      </Popconfirm>
      <Tooltip title="以该贮藏为起点创建并检出新的分支（打开分支命名窗口）">
        <Button size="small" data-testid={`branch-stash-${stash.index}`} onClick={() => onBranch(stash)}>
          转分支
        </Button>
      </Tooltip>
      {onUnstashAs !== undefined ? (
        <Tooltip title="先检出所选的目标分支，再把该贮藏应用上去（贮藏不弹出、保留在列表）">
          <Button size="small" data-testid={`unstash-as-${stash.index}`} onClick={() => onUnstashAs(stash)}>
            Unstash As…
          </Button>
        </Tooltip>
      ) : null}
      {onOpenDiff !== undefined ? (
        <Tooltip title="查看该贮藏的补丁内容（git stash show -p），只看不改工作区">
          <Button size="small" data-testid={`stash-diff-${stash.index}`} onClick={() => onOpenDiff(stash)}>
            查看差异
          </Button>
        </Tooltip>
      ) : null}
      <Popconfirm
        title={`确定删除 stash@{${stash.index}}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'drop', index: stash.index })}
      >
        <Tooltip title="从贮藏列表丢弃该条目（不动工作区改动，但丢弃后无法恢复）">
          <Button size="small" danger data-testid={`drop-stash-${stash.index}`}>
            删除
          </Button>
        </Tooltip>
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
      <Tooltip title="新分支名：不得与已有分支重名，留空时「确定」保持禁用">
        <Input
          data-testid="stash-branch-name-input"
          placeholder="新分支名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Tooltip>
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
  diffIndex,
  onOpenDiff,
  onCloseDiff,
  acting,
}: StashPanelProps): React.ReactNode {
  const [branchTarget, setBranchTarget] = useState<StashEntry | null>(null);
  const [unstashTarget, setUnstashTarget] = useState<StashEntry | null>(null);
  const [unstashBranch, setUnstashBranch] = useState<string | undefined>(undefined);
  const localBranches = (branches ?? []).filter((b) => !b.remote);
  const diffOpen = diffIndex !== undefined && diffIndex !== null;

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
                onOpenDiff={onOpenDiff === undefined ? undefined : (stash) => onOpenDiff(stash.index)}
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
          <Tooltip title="目标本地分支：仅列本地分支，远程分支不会出现在选项里">
            <Select
              data-testid="unstash-as-branch"
              placeholder="选择本地分支"
              style={{ width: '100%' }}
              value={unstashBranch}
              options={localBranches.map((b) => ({ value: b.name, label: b.name }))}
              onChange={setUnstashBranch}
            />
          </Tooltip>
        </Flex>
      </Modal>
      {/* 查看差异 Modal：git stash show -p 的 unified 补丁（数据由容器按 diffIndex 条件拉取；开关状态也由容器持有） */}
      <Modal
        title={`贮藏差异：stash@{${diffIndex ?? ''}}`}
        open={diffOpen}
        footer={null}
        width={720}
        onCancel={() => onCloseDiff?.()}
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
