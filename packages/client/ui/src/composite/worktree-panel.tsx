/**
 * 工作树面板：列表（path / 分支 / 「当前」标记（currentPath prop 与行 path 字符串相等命中——
 *  容器传入的 currentPath 与列表 path 已同源归一，组件不做文件系统操作）/ 分离 HEAD 徽标 + head 短哈希）
 *  + 行内「移除」Popconfirm（单参 path，不携带 force——用户需先处理工作树变更，force 仅终端使用）
 *  + 顶部「创建」Modal（路径 Input + 互斥 Radio：关联已有分支（Input）/ 创建新分支（Input）——
 *  组件只校验非空，路径是否在仓库内由服务层拦截）
 *  + 「清理」按钮（Popconfirm → onPrune）；刷新可选（缺省不渲染）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 *  所有可交互元素（按钮/输入/单选组及其选项/勾选）均一对一包 Tooltip；禁用按钮另包 span 承接悬停。
 */
import { useState } from 'react';
import { Button, Card, Checkbox, Flex, Input, Modal, Popconfirm, Radio, Tag, Tooltip, Typography } from 'antd';
import type { WorktreeCreateBody, WorktreeEntry, WorktreeList } from '@rebased/contracts';
import { EllipsisText } from '../base/ellipsis-text';
import { EmptyState } from '../base/empty-state';
import { Toolbar } from '../base/toolbar';

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
  onRemove: (path: string, force?: boolean) => void;
}): React.ReactNode {
  // 强制移除开关：默认关闭（安全默认）；勾选后带 force 调 onRemove（git worktree remove --force，丢弃其中的未提交改动）
  const [force, setForce] = useState(false);
  return (
    <Flex data-testid={`worktree-row-${wt.path}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {wt.path}
      </Typography.Text>
      {wt.branch !== null ? (
        // 分支名是不可断行的 ref（原 `flexShrink: 0` 的次要色文本会把行顶宽）→ EllipsisText 截断；
        // 次要色由 `type="secondary"` 转发保留，`title` 给完整分支名；**不加 `mono`**：
        // 改前此处是裸 `Typography.Text`（无 `code`），`mono` ⇒ `code` 会带上底色与内距（Ruling P17(b)）。
        // `fontSize: 12` 交紧凑密度（Ruling P4），`flexShrink: 0` 去掉（可收缩正是目的）。
        // 位置不动：仍在 path 之后、「当前/分离」Tag 之前。
        <EllipsisText type="secondary" title={wt.branch}>
          {wt.branch}
        </EllipsisText>
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
        description={
          <Flex vertical gap={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              工作树内有未提交改动时需勾选强制移除（其中的改动将被丢弃）
            </Typography.Text>
            <Tooltip title="勾选后移除会携带 --force：新工作树里未提交的改动将一并被丢弃">
              <Checkbox
                data-testid={`worktree-force-${wt.path}`}
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              >
                强制移除（--force）
              </Checkbox>
            </Tooltip>
          </Flex>
        }
        onConfirm={() => {
          const useForce = force;
          setForce(false);
          onRemove(wt.path, useForce);
        }}
      >
        {/* Tooltip 留在 Popconfirm 内侧；禁用按钮不派发 hover，故再包一层 span 承接悬停 */}
        <Tooltip
          title={
            acting
              ? '操作进行中：等当前操作结束后再移除该工作树'
              : '注销该工作树的登记并清空其目录（有未提交改动时 git 会拒绝，需勾选强制移除）'
          }
        >
          <span>
            <Button size="small" data-testid={`worktree-remove-${wt.path}`} disabled={acting}>
              移除
            </Button>
          </span>
        </Tooltip>
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
        <Tooltip title="工作树路径（必填）：新建的检出目录，须落在一个尚不存在的路径上">
          <Input
            data-testid="worktree-create-path"
            placeholder="工作树路径（必填）"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </Tooltip>
        {/* Radio.Group 自身算一个控件，组内每个 Radio 也是控件（会被外层组遮挡），故内外各包一个 Tooltip */}
        <Tooltip title="创建方式：决定新工作树检出的是已有分支还是新建分支，下方输入框随选择切换">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as CreateMode)}>
            <Flex gap={16}>
              <Tooltip title="关联已有分支：把该分支检出到新工作树（已被其它工作树检出的分支不能再选）">
                <Radio value="branch">关联已有分支</Radio>
              </Tooltip>
              <Tooltip title="创建新分支：以当前 HEAD 为起点新建分支并在新工作树里检出">
                <Radio value="new">创建新分支</Radio>
              </Tooltip>
            </Flex>
          </Radio.Group>
        </Tooltip>
        {mode === 'branch' ? (
          <Tooltip title="已有分支名（必填）：分支不存在时创建会被服务层拒绝">
            <Input
              data-testid="worktree-create-branch"
              placeholder="分支名（必填）"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </Tooltip>
        ) : (
          <Tooltip title="新分支名（必填）：不得与已有分支重名，创建后立即在新工作树检出">
            <Input
              data-testid="worktree-create-new-branch"
              placeholder="新分支名（必填）"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
            />
          </Tooltip>
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
          /* 卡头工具行改 Toolbar（gap 照抄原值 8）：原 Flex 不换行，窄屏三个按钮会溢出卡头；
             Toolbar 统一 flexWrap + width:100% + minWidth:0。宿主 `.ant-card-extra` 是 `flex: 0 1 auto`
             的收缩项（宽度由内容决定），子项 100% 按它自己的内容盒解析，宽屏下与原来等价，窄屏下多出换行能力。
             子项均为按钮，无需补 minWidth:0。 */
          <Toolbar gap={8}>
            {onRefresh !== undefined ? (
              // 卡头三个按钮都在 acting 期间禁用：禁用按钮不派发 hover，统一在 Tooltip 内包 span 承接悬停
              <Tooltip title={acting ? '操作进行中：等当前操作结束后再刷新列表' : '重新拉取工作树列表（外部命令改动过工作树时用）'}>
                <span>
                  <Button size="small" data-testid="worktree-refresh" disabled={acting} onClick={onRefresh}>
                    刷新
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title={acting ? '操作进行中：等当前操作结束后再创建工作树' : '在指定目录新建一个工作树（打开路径与分支弹窗）'}>
              <span>
                <Button size="small" data-testid="worktree-create" disabled={acting} onClick={() => setCreateOpen(true)}>
                  创建
                </Button>
              </span>
            </Tooltip>
            <Popconfirm title="确定清理失效工作树？" okText="确定" cancelText="取消" onConfirm={onPrune}>
              <Tooltip
                title={
                  acting
                    ? '操作进行中：等当前操作结束后再清理'
                    : '清理已失效的工作树登记（目录被手工删掉后遗留的条目）'
                }
              >
                <span>
                  <Button size="small" data-testid="worktree-prune" disabled={acting}>
                    清理
                  </Button>
                </span>
              </Tooltip>
            </Popconfirm>
          </Toolbar>
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
