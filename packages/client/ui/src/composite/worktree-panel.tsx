/**
 * 工作树面板：列表（path / 分支 / 「当前」标记（currentPath prop 与行 path 字符串相等命中——
 *  容器传入的 currentPath 与列表 path 已同源归一，组件不做文件系统操作）/ 分离 HEAD 徽标 + head 短哈希）
 *  + 行内「移除」Popconfirm（单参 path，不携带 force——用户需先处理工作树变更，force 仅终端使用）
 *  + 顶部「创建」Modal（路径 Input + 互斥 Radio：关联已有分支（Input）/ 创建新分支（Input）——
 *  组件只校验非空，路径是否在仓库内由服务层拦截）
 *  + 「清理」按钮（Popconfirm → onPrune）；刷新可选（缺省不渲染）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Radio, Tag, Typography } from 'antd';
import type { WorktreeCreateBody, WorktreeEntry, WorktreeList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';

export interface WorktreePanelProps {
  worktrees: WorktreeList;
  /** 高亮当前工作树（仓库根路径）：与行 path 字符串相等判定，不做文件系统操作 */
  currentPath?: string;
  onCreate: (body: WorktreeCreateBody) => void;
  onRemove: (path: string, force?: boolean) => void;
  onPrune: () => void;
  acting?: boolean;
  /** 刷新列表：缺省不渲染刷新按钮 */
  onRefresh?: () => void;
}

/** 创建模式：关联已有分支（检出既有分支）/ 创建新分支（检出新建分支）——两输入互斥，服务层校验分支存在性 */
type CreateMode = 'branch' | 'new';

/** 工作树行：path（弹性省略）+ 分支 + 「当前」Tag（currentPath 命中，绿）+ 「分离」Tag（orange）+ head 短哈希 + 移除 Popconfirm */
function WorktreeRow({
  wt,
  current,
  acting,
  onRemove,
}: {
  wt: WorktreeEntry;
  current: boolean;
  acting?: boolean;
  onRemove: (path: string) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`worktree-row-${wt.path}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {wt.path}
      </Typography.Text>
      {wt.branch !== null ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {wt.branch}
        </Typography.Text>
      ) : null}
      {current ? (
        <Tag color="green" style={{ flexShrink: 0 }}>
          当前
        </Tag>
      ) : null}
      {wt.detached ? (
        <Tag color="orange" style={{ flexShrink: 0 }}>
          分离
        </Tag>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {wt.head.slice(0, 7)}
      </Typography.Text>
      <Popconfirm
        title={`确定移除工作树 ${wt.path}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onRemove(wt.path)}
      >
        <Button size="small" data-testid={`worktree-remove-${wt.path}`} disabled={acting}>
          移除
        </Button>
      </Popconfirm>
    </Flex>
  );
}

/** 创建 Modal：路径非空 + 所在分支输入非空（按互斥模式取对应输入）才可提交；确认调 onCreate 并复位 */
function CreateWorktreeModal({
  open,
  acting,
  onCreate,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onCreate: (body: WorktreeCreateBody) => void;
  onClose: () => void;
}): React.ReactNode {
  const [path, setPath] = useState('');
  const [mode, setMode] = useState<CreateMode>('branch');
  const [branch, setBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');

  /** 关闭时复位全部输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setPath('');
    setMode('branch');
    setBranch('');
    setNewBranch('');
    onClose();
  };

  /** 有效 = 路径非空且按当前模式对应分支名输入非空（trim 后） */
  const valid = path.trim() !== '' && (mode === 'branch' ? branch.trim() !== '' : newBranch.trim() !== '');

  /** 提交并复位：按互斥模式映射载荷（branch 检出既有分支 / newBranch 新建并检出） */
  const submit = (): void => {
    if (mode === 'branch') {
      onCreate({ path: path.trim(), branch: branch.trim() });
    } else {
      onCreate({ path: path.trim(), newBranch: newBranch.trim() });
    }
    close();
  };

  return (
    <Modal
      title="创建工作树"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: !valid }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Input
          data-testid="worktree-create-path"
          placeholder="工作树路径（必填）"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as CreateMode)}>
          <Flex gap={16}>
            <Radio value="branch">关联已有分支</Radio>
            <Radio value="new">创建新分支</Radio>
          </Flex>
        </Radio.Group>
        {mode === 'branch' ? (
          <Input
            data-testid="worktree-create-branch"
            placeholder="分支名（必填）"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        ) : (
          <Input
            data-testid="worktree-create-new-branch"
            placeholder="新分支名（必填）"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
          />
        )}
      </Flex>
    </Modal>
  );
}

export function WorktreePanel(props: WorktreePanelProps): React.ReactNode {
  const { worktrees, currentPath, onCreate, onRemove, onPrune, acting, onRefresh } = props;
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Card
        size="small"
        title={`工作树（${worktrees.worktrees.length}）`}
        extra={
          <Flex gap={8}>
            {onRefresh !== undefined ? (
              <Button size="small" data-testid="worktree-refresh" disabled={acting} onClick={onRefresh}>
                刷新
              </Button>
            ) : null}
            <Button size="small" data-testid="worktree-create" disabled={acting} onClick={() => setCreateOpen(true)}>
              创建
            </Button>
            <Popconfirm title="确定清理失效工作树？" okText="确定" cancelText="取消" onConfirm={onPrune}>
              <Button size="small" data-testid="worktree-prune" disabled={acting}>
                清理
              </Button>
            </Popconfirm>
          </Flex>
        }
      >
        {worktrees.worktrees.length === 0 ? (
          <EmptyState title="暂无工作树" />
        ) : (
          <Flex vertical>
            {worktrees.worktrees.map((wt) => (
              <WorktreeRow
                key={wt.path}
                wt={wt}
                current={currentPath === undefined ? false : wt.path === currentPath}
                acting={acting}
                onRemove={onRemove}
              />
            ))}
          </Flex>
        )}
      </Card>
      <CreateWorktreeModal
        open={createOpen}
        acting={acting}
        onCreate={onCreate}
        onClose={() => setCreateOpen(false)}
      />
    </Flex>
  );
}
