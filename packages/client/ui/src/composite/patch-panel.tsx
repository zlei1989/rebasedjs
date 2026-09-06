/**
 * 补丁面板（对照 patch 存档动作面）：
 *  顶部「创建补丁」按钮开 Modal（name 必填 + 范围 Radio：工作区 / 暂存 / 提交区间——两输入框均可空，
 *  空侧省略，服务端按"单侧缺省=HEAD"裁定）；
 *  下方补丁列表 Card（空态 EmptyState）：行 = name + 大小（字节格式化）+ 创建时间 + 操作
 *  （应用 / 删除 Popconfirm）。
 *  载荷映射（控制器裁定，沿 tag/stash 的 optional 缺省省略惯例）：
 *  工作区 → {name}（省略 staged，服务端缺省视为 false → git diff HEAD）；
 *  暂存 → {name, staged:true}；提交区间 → {name, from?, to?}。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Radio, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { PatchCreateBody, PatchEntry, PatchList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface PatchPanelProps {
  patches: PatchList;
  onCreate: (body: PatchCreateBody) => void;
  onApply: (name: string) => void;
  onDelete: (name: string) => void;
  acting?: boolean;
}

/** 创建范围：工作区 = git diff HEAD（暂存+未暂存全量）；暂存 = git diff --cached；提交区间 = diff <from> <to> */
type CreateScope = 'workspace' | 'staged' | 'range';

/** 字节格式化：<1KB 显示 B，<1MB 显示 KB，其余 MB（一位小数）——format.ts 无字节助手，本地简单实现 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 补丁行：name + 大小 + 创建时间 + 应用（直发）/ 删除（Popconfirm 确认）；acting 期间行按钮禁用防重复 */
function PatchRow({
  patch,
  acting,
  onApply,
  onDelete,
}: {
  patch: PatchEntry;
  acting?: boolean;
  onApply: (name: string) => void;
  onDelete: (name: string) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-patch-${patch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {patch.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatBytes(patch.size)}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(patch.createdAtIso)}
      </Typography.Text>
      <Button size="small" data-testid={`apply-patch-${patch.name}`} disabled={acting} onClick={() => onApply(patch.name)}>
        应用
      </Button>
      <Popconfirm
        title={`确定删除补丁 ${patch.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onDelete(patch.name)}
      >
        <Button size="small" danger data-testid={`delete-patch-${patch.name}`} disabled={acting}>
          删除
        </Button>
      </Popconfirm>
    </Flex>
  );
}

/** 创建补丁 Modal：name 必填（空则确定禁用）+ 范围 Radio；from/to 仅在提交区间展示且均可空 */
function CreatePatchModal({
  open,
  acting,
  onCreate,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onCreate: (body: PatchCreateBody) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<CreateScope>('workspace');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /** 关闭时复位全部输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setName('');
    setScope('workspace');
    setFrom('');
    setTo('');
    onClose();
  };

  /** 提交并复位：按范围映射载荷；from/to 仅非空时携带（服务端单侧缺省=HEAD） */
  const submit = (): void => {
    const trimmedName = name.trim();
    if (scope === 'staged') {
      onCreate({ name: trimmedName, staged: true });
    } else if (scope === 'range') {
      const trimmedFrom = from.trim();
      const trimmedTo = to.trim();
      onCreate({
        name: trimmedName,
        ...(trimmedFrom === '' ? {} : { from: trimmedFrom }),
        ...(trimmedTo === '' ? {} : { to: trimmedTo }),
      });
    } else {
      // 工作区：省略 staged（缺省 false → git diff HEAD）
      onCreate({ name: trimmedName });
    }
    close();
  };

  return (
    <Modal
      title="创建补丁"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Input
          data-testid="patch-create-name"
          placeholder="补丁名（必填）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as CreateScope)}>
          <Flex gap={16}>
            <Radio value="workspace">工作区</Radio>
            <Radio value="staged">暂存</Radio>
            <Radio value="range">提交区间</Radio>
          </Flex>
        </Radio.Group>
        {scope === 'range' ? (
          <Flex vertical gap={8}>
            <Input
              data-testid="patch-create-from"
              placeholder="起点（分支/提交，可空默认 HEAD）"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              data-testid="patch-create-to"
              placeholder="终点（分支/提交，可空默认 HEAD）"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Flex>
        ) : null}
      </Flex>
    </Modal>
  );
}

export function PatchPanel({ patches, onCreate, onApply, onDelete, acting }: PatchPanelProps): React.ReactNode {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Flex>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          data-testid="patch-create-button"
          loading={acting}
          onClick={() => setCreateOpen(true)}
        >
          创建补丁
        </Button>
      </Flex>
      <Card size="small" title={`补丁列表（${patches.patches.length}）`}>
        {patches.patches.length === 0 ? (
          <EmptyState title="暂无补丁" />
        ) : (
          <Flex vertical>
            {patches.patches.map((patch) => (
              <PatchRow
                key={patch.name}
                patch={patch}
                acting={acting}
                onApply={onApply}
                onDelete={onDelete}
              />
            ))}
          </Flex>
        )}
      </Card>
      <CreatePatchModal
        open={createOpen}
        acting={acting}
        onCreate={onCreate}
        onClose={() => setCreateOpen(false)}
      />
    </Flex>
  );
}
