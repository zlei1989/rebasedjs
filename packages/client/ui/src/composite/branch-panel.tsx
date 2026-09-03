/**
 * 分支面板：本地/远程两组列表（对照 Java BranchesTreeModel 分组维度）。
 *  行内信息：current 标记、upstream+ ahead/behind 徽标（0 不显示）、mergedIntoHead 图标（绿色对勾 Tooltip"已合并"）。
 *  操作：新建分支（Modal：名称 + 起始点可选 + 创建后检出开关）、检出、删除（Popconfirm；未合并提示需 force）、
 *        重命名（Modal 单输入）、设上游（Modal 单输入）。远程行 v1 只读展示。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈（message.error）由容器负责。
 */
import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Dropdown,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CheckOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import type { BranchAction, BranchList, BranchRef, CheckoutAction } from '@rebased/contracts';

export interface BranchPanelProps {
  branches: BranchList;
  onAction: (action: BranchAction) => void;
  onCheckout: (action: CheckoutAction) => void;
  acting?: boolean;
}

/** 行内上游信息：上游名 + ↑ahead ↓behind 徽标（0 不显示对应箭头）；无上游时整体不渲染 */
function UpstreamInfo({ branch }: { branch: BranchRef }): React.ReactNode {
  if (branch.upstream === null) return null;
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {branch.upstream}
      {branch.ahead > 0 ? ` ↑${branch.ahead}` : ''}
      {branch.behind > 0 ? ` ↓${branch.behind}` : ''}
    </Typography.Text>
  );
}

/** 已合并图标：mergedIntoHead=true 时绿色对勾，Tooltip"已合并" */
function MergedIcon({ branch }: { branch: BranchRef }): React.ReactNode {
  if (!branch.mergedIntoHead) return null;
  return (
    <Tooltip title="已合并">
      <CheckOutlined data-testid={`merged-icon-${branch.name}`} style={{ color: '#52c41a' }} />
    </Tooltip>
  );
}

/** 新建分支 Modal：名称必填 + 起始点可空 + "创建后检出"开关（勾时走 onCheckout newBranch，否则 onAction create） */
function CreateBranchModal({
  open,
  acting,
  onAction,
  onCheckout,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onAction: (action: BranchAction) => void;
  onCheckout: (action: CheckoutAction) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [checkout, setCheckout] = useState(false);

  /** 关闭时复位三个输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setName('');
    setStartPoint('');
    setCheckout(false);
    onClose();
  };

  /** 提交并复位：起始点仅在非空时携带（契约 create/newBranch 的 startPoint 均为 optional） */
  const submit = (): void => {
    const trimmed = name.trim();
    const sp = startPoint.trim();
    const extra = sp === '' ? {} : { startPoint: sp };
    if (checkout) {
      onCheckout({ action: 'newBranch', name: trimmed, ...extra });
    } else {
      onAction({ action: 'create', name: trimmed, ...extra });
    }
    close();
  };

  return (
    <Modal
      title="新建分支"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '', 'data-testid': 'create-submit' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={8}>
        <Input
          data-testid="create-name"
          placeholder="分支名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          data-testid="create-start-point"
          placeholder="起始点（可空，默认 HEAD）"
          value={startPoint}
          onChange={(e) => setStartPoint(e.target.value)}
        />
        <Checkbox checked={checkout} onChange={(e) => setCheckout(e.target.checked)}>
          创建后检出
        </Checkbox>
      </Flex>
    </Modal>
  );
}

/** 单输入 Modal 通用件：重命名/设上游复用（标题与占位文案不同，提交回调由调用方组装 action） */
function SingleInputModal({
  title,
  open,
  acting,
  placeholder,
  inputTestId,
  onSubmit,
  onClose,
}: {
  title: string;
  open: boolean;
  acting?: boolean;
  placeholder: string;
  inputTestId: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const [value, setValue] = useState('');

  /** 关闭时清空输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setValue('');
    onClose();
  };

  const submit = (): void => {
    onSubmit(value.trim());
    close();
  };

  return (
    <Modal
      title={title}
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: value.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Input
        data-testid={inputTestId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Modal>
  );
}

/** 本地分支行：名称 + current Tag + 上游徽标 + 合并图标 + 行尾 Dropdown（检出/重命名/设上游/删除） */
function LocalBranchRow({
  branch,
  pendingDelete,
  onMenuAction,
  onDelete,
  onDeleteCancel,
}: {
  branch: BranchRef;
  /** 当前等待删除确认的分支名（受控 Popconfirm 锚定本行菜单按钮） */
  pendingDelete: string | null;
  onMenuAction: (key: 'checkout' | 'rename' | 'setUpstream' | 'delete', branch: BranchRef) => void;
  onDelete: (branch: BranchRef) => void;
  onDeleteCancel: () => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-local-${branch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {branch.name}
      </Typography.Text>
      {branch.current && <Tag color="green">当前</Tag>}
      <UpstreamInfo branch={branch} />
      <MergedIcon branch={branch} />
      {/* 删除走受控 Popconfirm：Dropdown 菜单项点击即关菜单，故确认框锚定在菜单按钮上按状态开关 */}
      <Popconfirm
        open={pendingDelete === branch.name}
        title={branch.mergedIntoHead ? `确定删除分支 ${branch.name}？` : '该分支未合并，删除将使用强制删除'}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onDelete(branch)}
        onCancel={onDeleteCancel}
      >
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'checkout', label: '检出' },
              { key: 'rename', label: '重命名' },
              { key: 'setUpstream', label: '设上游' },
              // 当前分支禁止删除（git branch -d 当前头分支无意义，服务端也会拒绝）
              { key: 'delete', label: '删除', danger: true, disabled: branch.current },
            ],
            onClick: ({ key }) =>
              onMenuAction(key as 'checkout' | 'rename' | 'setUpstream' | 'delete', branch),
          }}
        >
          <Button size="small" type="text" icon={<MoreOutlined />} data-testid={`menu-local-${branch.name}`} />
        </Dropdown>
      </Popconfirm>
    </Flex>
  );
}

/** 远程分支行：v1 只读展示（无操作菜单；检出为本地分支等后续支持） */
function RemoteBranchRow({ branch }: { branch: BranchRef }): React.ReactNode {
  return (
    <Flex data-testid={`row-remote-${branch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {branch.name}
      </Typography.Text>
      <UpstreamInfo branch={branch} />
      <MergedIcon branch={branch} />
    </Flex>
  );
}

/** 分支组卡片：标题带计数；行列表用 Flex vertical 渲染（antd v6 已弃用 List） */
function BranchGroupCard({
  title,
  rows,
}: {
  title: string;
  rows: React.ReactNode;
}): React.ReactNode {
  return (
    <Card size="small" title={title}>
      <Flex vertical>{rows}</Flex>
    </Card>
  );
}

export function BranchPanel({ branches, onAction, onCheckout, acting }: BranchPanelProps): React.ReactNode {
  const locals = useMemo(() => branches.branches.filter((b) => !b.remote), [branches]);
  const remotes = useMemo(() => branches.branches.filter((b) => b.remote), [branches]);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [upstreamTarget, setUpstreamTarget] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  /** 行菜单分派：检出直发回调；重命名/设上游开对应 Modal；删除开受控 Popconfirm */
  const handleMenuAction = (key: 'checkout' | 'rename' | 'setUpstream' | 'delete', branch: BranchRef): void => {
    if (key === 'checkout') onCheckout({ action: 'branch', name: branch.name });
    if (key === 'rename') setRenameTarget(branch.name);
    if (key === 'setUpstream') setUpstreamTarget(branch.name);
    if (key === 'delete') setPendingDelete(branch.name);
  };

  /** 删除确认：未合并（mergedIntoHead=false）需强制删除，传 force:true */
  const handleDelete = (branch: BranchRef): void => {
    onAction(
      branch.mergedIntoHead
        ? { action: 'delete', name: branch.name }
        : { action: 'delete', name: branch.name, force: true },
    );
    setPendingDelete(null);
  };

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      {/* 顶部工具条：新建分支入口 */}
      <Flex>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          data-testid="create-branch-button"
          loading={acting}
          onClick={() => setCreateOpen(true)}
        >
          新建分支
        </Button>
      </Flex>

      <BranchGroupCard
        title={`本地分支（${locals.length}）`}
        rows={
          locals.length === 0 ? (
            <Typography.Text type="secondary">无本地分支</Typography.Text>
          ) : (
            locals.map((branch) => (
              <LocalBranchRow
                key={branch.name}
                branch={branch}
                pendingDelete={pendingDelete}
                onMenuAction={handleMenuAction}
                onDelete={handleDelete}
                onDeleteCancel={() => setPendingDelete(null)}
              />
            ))
          )
        }
      />
      <BranchGroupCard
        title={`远程分支（${remotes.length}）`}
        rows={
          remotes.length === 0 ? (
            <Typography.Text type="secondary">无远程分支</Typography.Text>
          ) : (
            remotes.map((branch) => <RemoteBranchRow key={branch.name} branch={branch} />)
          )
        }
      />

      <CreateBranchModal
        open={createOpen}
        acting={acting}
        onAction={onAction}
        onCheckout={onCheckout}
        onClose={() => setCreateOpen(false)}
      />
      {/* 重命名/设上游 Modal 互斥（target 非空才开），提交后清空输入并关闭 */}
      <SingleInputModal
        title={`重命名分支 ${renameTarget ?? ''}`}
        open={renameTarget !== null}
        acting={acting}
        placeholder="新分支名"
        inputTestId="rename-input"
        onSubmit={(newName) => {
          if (renameTarget !== null) onAction({ action: 'rename', oldName: renameTarget, newName });
        }}
        onClose={() => setRenameTarget(null)}
      />
      <SingleInputModal
        title={`设置上游：${upstreamTarget ?? ''}`}
        open={upstreamTarget !== null}
        acting={acting}
        placeholder="上游分支（如 origin/main）"
        inputTestId="upstream-input"
        onSubmit={(upstream) => {
          if (upstreamTarget !== null) onAction({ action: 'setUpstream', name: upstreamTarget, upstream });
        }}
        onClose={() => setUpstreamTarget(null)}
      />
    </Flex>
  );
}
