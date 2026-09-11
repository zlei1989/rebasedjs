/**
 * 分支面板：本地/远程两组列表 + 最近检出组（reflog）+ 标签组（对照 Java BranchesTreeModel 分组维度；
 * showRecentBranches/showTags 页面级开关默认开，对齐 Java 设置默认）。
 *  行内信息：current 标记、upstream+ ahead/behind 徽标（0 不显示）、mergedIntoHead 图标（绿色对勾 Tooltip"已合并"）。
 *  操作：新建分支（Modal：名称 + 起始点可选 + 创建后检出开关）、检出、删除（Popconfirm；未合并提示需 force）、
 *        重命名（Modal 单输入）、设上游（Modal 单输入）。
 *  过滤/查找：文本过滤（名称子串，四组共用）+「仅看已合并」开关 +「清理已合并」批量删除（Popconfirm 确认，
 *        容器经既有 delete action 顺序删除——本地已合并且非当前分支，可安全删除无需 force）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈（message.error）由容器负责。
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { CheckOutlined, DeleteOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import type { BranchAction, BranchList, BranchRef, BranchWorkingDiff, CheckoutAction, TagEntry, TagList } from '@rebased/contracts';
import { Toolbar } from '../base/toolbar';
import { CommittedStatusTag } from '../domain/committed-status';

export interface BranchPanelProps {
  branches: BranchList;
  onAction: (action: BranchAction) => void;
  onCheckout: (action: CheckoutAction) => void;
  /** 清理已合并到 HEAD 的本地分支（容器按顺序逐条 delete；已合并删除无需 force）；缺省不渲染清理按钮 */
  onCleanupMerged?: () => void;
  /** 与当前分支比较（GitCompareWithBranchAction 语义）：本地行渲染「比较」按钮（当前分支禁用）；缺省不渲染 */
  onCompare?: (branch: string) => void;
  /** 弹窗 Fetch（GitBranchPopupFetchAction 语义）：fetch 全部远程；缺省不渲染按钮 */
  onFetch?: () => void;
  /** fetch 请求进行中：按钮 loading 态 */
  fetching?: boolean;
  /** force-push 后修复（GitForcePushedBranchUpdateAction 语义）：当前分支与上游分叉（ahead>0 且 behind>0）
   *  时当前行渲染「force-push 修复」按钮；缺省不渲染 */
  onForcePushedUpdate?: () => void;
  /** 检出并变基到当前（GitCheckoutWithRebaseAction 语义）：目标分支检出后 rebase onto 变基前所在分支；
   *  本地行菜单项直发 {branch}，远程行经本地名 Modal（prefill 剥 origin/ 前缀）后回传 {branch, localName}；缺省不渲染 */
  onCheckoutRebase?: (request: { branch: string; localName?: string }) => void;
  /** 检出并更新（GitCheckoutWithUpdateAction 语义）：本地行菜单直发 {branch}——检出后 fetch 跟踪分支 + 策略化更新
   *  （strategy 缺省 merge，对齐更新策略默认）；无上游分支行该项禁用；缺省不渲染 */
  onCheckoutUpdate?: (request: { branch: string; strategy?: 'merge' | 'rebase' }) => void;
  /** 与工作树差异（GitShowDiffWithRefAction 语义）：本地行菜单直发 branch——打开分支 vs 当前工作树差异 Modal；缺省不渲染 */
  onShowDiffWithWorkingTree?: (branch: string) => void;
  /** 差异 Modal 受控打开键（容器经 useBranchWorkingDiff 条件拉取；'' = 关闭） */
  workingDiffBranch?: string;
  /** 差异 Modal 数据（容器条件拉取） */
  workingDiffData?: BranchWorkingDiff | null;
  /** 差异拉取中 */
  workingDiffLoading?: boolean;
  /** 差异拉取错误信息 */
  workingDiffError?: string | null;
  /** 关闭差异 Modal（容器清空 branch 停止拉取） */
  onCloseWorkingDiff?: () => void;
  /** 差异文件行点击（容器据此导航 DiffPage：?file=&from=<branch>） */
  onOpenWorkingDiffFile?: (branch: string, path: string) => void;
  /** 标签列表（GitBranchesTreeSingleRepoModel tags 组语义）：注入时渲染「标签」组卡片（行内「检出」→ detached）；
   *  缺省不渲染（向后兼容） */
  tags?: TagList;
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

/** 已合并图标：mergedIntoHead=true 时绿色对勾，Tooltip"已合并"（色值走主题 colorSuccess，暗/亮一致） */
function MergedIcon({ branch }: { branch: BranchRef }): React.ReactNode {
  const { token } = theme.useToken();
  if (!branch.mergedIntoHead) return null;
  return (
    <Tooltip title="已合并">
      <CheckOutlined data-testid={`merged-icon-${branch.name}`} style={{ color: token.colorSuccess }} />
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
        <Tooltip title="填写分支名称：必填，重名或非法名由服务端拒绝">
          <Input
            data-testid="create-name"
            placeholder="分支名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="填写起始点：可空，留空取当前 HEAD，也可填分支名或提交哈希">
          <Input
            data-testid="create-start-point"
            placeholder="起始点（可空，默认 HEAD）"
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="勾选后创建并立即检出该分支（走检出流程，未提交改动可能使其失败）">
          <Checkbox checked={checkout} onChange={(e) => setCheckout(e.target.checked)}>
            创建后检出
          </Checkbox>
        </Tooltip>
      </Flex>
    </Modal>
  );
}

/** 单输入 Modal 通用件：重命名/设上游/远程分支本地名复用（标题与占位文案不同，提交回调由调用方组装 action）；
 *  initialValue 仅初始化（需要重开时由调用方以 key 重挂载重置） */
function SingleInputModal({
  title,
  open,
  acting,
  placeholder,
  inputTestId,
  initialValue = '',
  onSubmit,
  onClose,
}: {
  title: string;
  open: boolean;
  acting?: boolean;
  placeholder: string;
  inputTestId: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const [value, setValue] = useState(initialValue);

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
      <Tooltip title={`填写${placeholder}：点「确定」即提交（首尾空白自动去除），取消不生效`}>
        <Input
          data-testid={inputTestId}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Tooltip>
    </Modal>
  );
}

/** 本地分支行：名称 + current Tag + 上游徽标 + 合并图标 + 行尾 Dropdown（检出/检出并变基/重命名/设上游/删除）+ 比较按钮 + force-push 修复 */
function LocalBranchRow({
  branch,
  pendingDelete,
  onMenuAction,
  onDelete,
  onDeleteCancel,
  onCompare,
  onForcePushedUpdate,
  hasCheckoutRebase,
  hasCheckoutUpdate,
  hasWorkingDiff,
}: {
  branch: BranchRef;
  /** 当前等待删除确认的分支名（受控 Popconfirm 锚定本行菜单按钮） */
  pendingDelete: string | null;
  onMenuAction: (key: 'checkout' | 'checkoutRebase' | 'checkoutUpdate' | 'workingDiff' | 'rename' | 'setUpstream' | 'delete', branch: BranchRef) => void;
  onDelete: (branch: BranchRef) => void;
  onDeleteCancel: () => void;
  /** 是否渲染「检出并变基到当前」菜单项（容器已接 onCheckoutRebase 时 true） */
  hasCheckoutRebase: boolean;
  /** 是否渲染「检出并更新」菜单项（容器已接 onCheckoutUpdate 时 true） */
  hasCheckoutUpdate: boolean;
  /** 是否渲染「与工作树差异」菜单项（容器已接 onShowDiffWithWorkingTree 时 true） */
  hasWorkingDiff: boolean;
  /** 与当前分支比较（GitCompareWithBranchAction 语义）；当前分支无意义（A..A 空循环），禁用 */
  onCompare?: (branch: string) => void;
  /** force-push 后修复（GitForcePushedBranchUpdateAction 语义）：当前分支与上游分叉（ahead>0 且 behind>0）时渲染 */
  onForcePushedUpdate?: () => void;
}): React.ReactNode {
  const diverged = branch.current && branch.upstream !== null && branch.ahead > 0 && branch.behind > 0;
  return (
    <Flex data-testid={`row-local-${branch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {branch.name}
      </Typography.Text>
      {branch.current && <Tag color="green">当前</Tag>}
      <UpstreamInfo branch={branch} />
      <MergedIcon branch={branch} />
      {/* 「比较」：对比视图入口（两分支独有提交双向视图）；点击不触发行其他行为。
          当前分支禁用，antd 禁用按钮不派发 hover 事件，故在 Tooltip 与 Button 之间包一层 span 承接提示 */}
      {onCompare !== undefined && (
        <Tooltip
          title={
            branch.current
              ? '当前分支与自己比较恒为空（A..A），切到其它分支后再用'
              : '与该分支双向比较独有提交：进入对比视图，不检出、不改工作树'
          }
        >
          <span>
            <Button
              size="small"
              type="text"
              data-testid={`compare-local-${branch.name}`}
              disabled={branch.current}
              onClick={() => onCompare(branch.name)}
            >
              比较
            </Button>
          </span>
        </Tooltip>
      )}
      {/* force-push 修复：远端被强推（本地与上游分叉且无法普通更新）时的恢复通道——重置到上游 + 重放本地提交 */}
      {onForcePushedUpdate !== undefined && diverged ? (
        <Tooltip title="重置到上游并重放本地提交：远端已被强推时的恢复通道，会改写本地分支历史">
          <Button
            size="small"
            type="text"
            danger
            data-testid={`force-push-fix-${branch.name}`}
            onClick={onForcePushedUpdate}
          >
            force-push 修复
          </Button>
        </Tooltip>
      ) : null}
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
              // 菜单项 label 用 Tooltip > span 包裹：菜单项是数据对象而非 JSX（Dropdown 下 MenuItemType.title 不弹），
              // span 让 antd 的菜单项样式与禁用态照旧生效
              { key: 'checkout', label: <Tooltip title="检出该分支：把工作区切到它的最新提交（未提交的改动可能被拒绝或覆盖）"><span>检出</span></Tooltip> },
              // 检出并变基到当前（GitCheckoutWithRebaseAction 语义）：检出本行分支后 rebase onto 当前分支；当前分支无意义，禁用
              ...(hasCheckoutRebase
                ? [{ key: 'checkoutRebase', label: <Tooltip title="检出该分支后把它变基到当前分支：重新应用其提交（提交哈希会被重写）"><span>检出并变基到当前</span></Tooltip>, disabled: branch.current }]
                : []),
              // 检出并更新（GitCheckoutWithUpdateAction 语义）：检出后 fetch 跟踪分支 + 策略化更新；当前分支/无上游无意义，禁用
              ...(hasCheckoutUpdate
                ? [{ key: 'checkoutUpdate', label: <Tooltip title="检出该分支后拉取并更新上游：按配置策略合并或变基到跟踪分支"><span>检出并更新</span></Tooltip>, disabled: branch.current || branch.upstream === null }]
                : []),
              // 与工作树差异（GitShowDiffWithRefAction 语义）：分支 vs 当前工作树（含未提交变更）；当前分支无意义，禁用
              ...(hasWorkingDiff
                ? [{ key: 'workingDiff', label: <Tooltip title="对比该分支与当前工作树（含未提交改动）的文件差异"><span>与工作树差异</span></Tooltip>, disabled: branch.current }]
                : []),
              { key: 'rename', label: <Tooltip title="重命名该分支：随后弹出对话框填写新名称"><span>重命名</span></Tooltip> },
              { key: 'setUpstream', label: <Tooltip title="为该分支指定跟踪的远程分支：影响拉取与推送的默认目标"><span>设上游</span></Tooltip> },
              // 当前分支禁止删除（git branch -d 当前头分支无意义，服务端也会拒绝）
              { key: 'delete', label: <Tooltip title="删除该分支：未合并的分支将强制删除，其独有提交不可恢复"><span>删除</span></Tooltip>, danger: true, disabled: branch.current },
            ],
            onClick: ({ key }) =>
              onMenuAction(
                key as 'checkout' | 'checkoutRebase' | 'checkoutUpdate' | 'workingDiff' | 'rename' | 'setUpstream' | 'delete',
                branch,
              ),
          }}
        >
          {/* Tooltip 放在 Dropdown 之内、Button 之外：保持 Popconfirm → Dropdown → Button 的触发链完整，
              同时让「菜单按钮」自己带一对一提示（点击展开菜单，悬停即可说明菜单用途） */}
          <Tooltip title="展开该分支的操作菜单：检出、重命名、设上游、删除等（部分项按当前状态禁用）">
            <Button size="small" type="text" icon={<MoreOutlined />} data-testid={`menu-local-${branch.name}`} />
          </Tooltip>
        </Dropdown>
      </Popconfirm>
    </Flex>
  );
}

/** 远程分支行：名称 + 上游徽标 + 合并图标 + 行尾 Dropdown（检出并变基到当前——远程分支新本地名缺省剥 origin/ 前缀，
 *  同名本地分支冲突由容器/服务端拒绝；无该操作时 v1 只读展示） */
function RemoteBranchRow({
  branch,
  hasCheckoutRebase,
  onMenuAction,
}: {
  branch: BranchRef;
  hasCheckoutRebase: boolean;
  onMenuAction: (key: 'checkoutRebase', branch: BranchRef) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-remote-${branch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {branch.name}
      </Typography.Text>
      <UpstreamInfo branch={branch} />
      <MergedIcon branch={branch} />
      {hasCheckoutRebase && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [{ key: 'checkoutRebase', label: <Tooltip title="检出该远程分支并变基到当前：先按去掉远程前缀的名称新建本地分支"><span>检出并变基到当前</span></Tooltip> }],
            onClick: ({ key }) => {
              if (key === 'checkoutRebase') onMenuAction('checkoutRebase', branch);
            },
          }}
        >
          <Tooltip title="展开该远程分支的操作菜单：检出并变基到当前（新建同名本地分支后检出）">
            <Button size="small" type="text" icon={<MoreOutlined />} data-testid={`menu-remote-${branch.name}`} />
          </Tooltip>
        </Dropdown>
      )}
    </Flex>
  );
}

/** 最近检出行（GitBranchesPopup recent 组语义）：名称 + current 标记 + 上游徽标 + 行内「检出」 */
function RecentBranchRow({
  branch,
  onCheckout,
}: {
  branch: BranchRef;
  onCheckout: (action: CheckoutAction) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-recent-${branch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {branch.name}
      </Typography.Text>
      {branch.current && <Tag color="green">当前</Tag>}
      <UpstreamInfo branch={branch} />
      <Tooltip title="检出该分支：切换当前分支并更新工作树（存在未提交改动时可能被拒绝）">
        <Button
          size="small"
          type="text"
          data-testid={`recent-checkout-${branch.name}`}
          onClick={() => onCheckout({ action: 'branch', name: branch.name })}
        >
          检出
        </Button>
      </Tooltip>
    </Flex>
  );
}

/** 标签行（tags 组语义：行内「检出」→ detached 检出标签） */
function TagRow({ tag, onCheckout }: { tag: TagEntry; onCheckout: (action: CheckoutAction) => void }): React.ReactNode {
  return (
    <Flex data-testid={`row-tag-${tag.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {tag.name}
      </Typography.Text>
      {tag.annotated && <Tag>附注</Tag>}
      <Tooltip title="以 detached HEAD 检出该标签：只读查看该版本，不落在任何分支上">
        <Button
          size="small"
          type="text"
          data-testid={`tag-checkout-${tag.name}`}
          onClick={() => onCheckout({ action: 'detach', ref: tag.name })}
        >
          检出
        </Button>
      </Tooltip>
    </Flex>
  );
}

/** 分支组卡片：标题带计数；行列表用 Flex vertical 渲染（antd v6 已弃用 List） */function BranchGroupCard({
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

export function BranchPanel({
  branches,
  onAction,
  onCheckout,
  onCleanupMerged,
  onCompare,
  onFetch,
  fetching,
  onForcePushedUpdate,
  onCheckoutRebase,
  onCheckoutUpdate,
  onShowDiffWithWorkingTree,
  workingDiffBranch,
  workingDiffData,
  workingDiffLoading,
  workingDiffError,
  onCloseWorkingDiff,
  onOpenWorkingDiffFile,
  tags,
  acting,
}: BranchPanelProps): React.ReactNode {
  // 过滤态：文本（名称大小写不敏感子串）+「仅看已合并」（本地/远程两组同筛选——Java 查找已合并语义）
  const [filterText, setFilterText] = useState('');
  const [mergedOnly, setMergedOnly] = useState(false);
  const match = (b: BranchRef): boolean => {
    if (mergedOnly && !b.mergedIntoHead) return false;
    const q = filterText.trim().toLowerCase();
    return q === '' || b.name.toLowerCase().includes(q);
  };
  const locals = useMemo(() => branches.branches.filter((b) => !b.remote), [branches]);
  const remotes = useMemo(() => branches.branches.filter((b) => b.remote), [branches]);
  /** 清理目标：本地已合并且非当前分支（当前分支不可删） */
  // 清理候选：已合并入 HEAD 且非当前分支，且未被任何 worktree 检出（后者 git 必然拒绝删除，
  // 计入会让「清理已合并（N）」承诺可清理却失败——冒烟 D-20）
  const mergedLocals = useMemo(
    () => locals.filter((b) => b.mergedIntoHead && !b.current && b.checkedOutInWorktree !== true),
    [locals],
  );
  const visibleLocals = useMemo(() => locals.filter(match), [locals, filterText, mergedOnly]);
  const visibleRemotes = useMemo(() => remotes.filter(match), [remotes, filterText, mergedOnly]);

  // 最近检出/标签分组（Java showRecentBranches/showTags 默认开）：页面级开关；最近组只受文本过滤（历史视图不受「仅看已合并」约束）
  const [showRecent, setShowRecent] = useState(true);
  const [showTags, setShowTags] = useState(true);
  const recentRefs = useMemo(() => {
    const byName = new Map(locals.map((b) => [b.name, b]));
    return branches.recent
      .map((n) => byName.get(n))
      .filter((b): b is BranchRef => b !== undefined);
  }, [branches, locals]);
  const visibleRecent = useMemo(() => {
    if (!showRecent) return [];
    const q = filterText.trim().toLowerCase();
    return recentRefs.filter((b) => q === '' || b.name.toLowerCase().includes(q));
  }, [showRecent, recentRefs, filterText]);
  const visibleTags = useMemo(() => {
    if (!showTags || tags === undefined) return [];
    const q = filterText.trim().toLowerCase();
    return tags.tags.filter((t) => q === '' || t.name.toLowerCase().includes(q));
  }, [showTags, tags, filterText]);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [upstreamTarget, setUpstreamTarget] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [remoteRebaseTarget, setRemoteRebaseTarget] = useState<string | null>(null);

  /** 行菜单分派：检出直发回调；检出并变基本地行直发、远程行开本地名 Modal；检出并更新/与工作树差异本地行直发；
   *  重命名/设上游开对应 Modal；删除开受控 Popconfirm */
  const handleMenuAction = (
    key: 'checkout' | 'checkoutRebase' | 'checkoutUpdate' | 'workingDiff' | 'rename' | 'setUpstream' | 'delete',
    branch: BranchRef,
  ): void => {
    if (key === 'checkout') onCheckout({ action: 'branch', name: branch.name });
    if (key === 'checkoutRebase') {
      if (branch.remote) setRemoteRebaseTarget(branch.name);
      else onCheckoutRebase?.({ branch: branch.name });
    }
    if (key === 'checkoutUpdate') onCheckoutUpdate?.({ branch: branch.name });
    if (key === 'workingDiff') onShowDiffWithWorkingTree?.(branch.name);
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
      {/* 顶部工具条：新建分支 + 过滤/查找已合并 + 清理已合并。
          横向工具行改 Toolbar（gap 照抄原值 8；交叉轴 align 固定 center，与原 align="center" 等价），
          由原语统一 flexWrap + width:100% + minWidth:0（D-12「标签被压成竖排」的成因）。
          子项无需补 minWidth:0：过滤输入是固定 width:200（非弹性项，改 flex:1 会变动间距口径），
          其余子项都是按钮/勾选（antd 自带可收缩性）。 */}
      <Toolbar gap={8}>
        <Tooltip title="打开新建分支弹窗：可指定起始点，并选择创建后是否立即检出">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            data-testid="create-branch-button"
            loading={acting}
            onClick={() => setCreateOpen(true)}
          >
            新建分支
          </Button>
        </Tooltip>
        <Tooltip title="过滤下方分支列表：按名称子串匹配（大小写不敏感），四组共用同一关键字">
          <Input
            data-testid="branch-filter"
            placeholder="过滤分支名"
            allowClear
            style={{ width: 200 }}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="只保留已合并到 HEAD 的分支（本地与远程同筛），便于确认清理范围">
          <Checkbox checked={mergedOnly} onChange={(e) => setMergedOnly(e.target.checked)}>
            仅看已合并
          </Checkbox>
        </Tooltip>
        {/* 分组维度开关（Java showRecentBranches/showTags 默认 true）：最近检出组仅有数据时渲染；标签组仅在注入 tags 时可用 */}
        <Tooltip title="开关注最近检出分组的显隐：数据取自 reflog 历史，只受文本过滤影响">
          <Checkbox checked={showRecent} onChange={(e) => setShowRecent(e.target.checked)}>
            显示最近检出
          </Checkbox>
        </Tooltip>
        {tags !== undefined && (
          <Tooltip title="开关注标签分组的显隐：仅在容器注入标签列表时可用">
            <Checkbox checked={showTags} onChange={(e) => setShowTags(e.target.checked)}>
              显示标签
            </Checkbox>
          </Tooltip>
        )}
        {onCleanupMerged !== undefined ? (
          <Popconfirm
            title={`清理 ${mergedLocals.length} 个已合并分支？不可恢复`}
            okText="确定"
            cancelText="取消"
            disabled={mergedLocals.length === 0}
            onConfirm={onCleanupMerged}
          >
            {/* Tooltip 放在 Popconfirm 之内（最内层）：保持确认气泡的触发链完整；
                计数为 0 时按钮禁用，antd 禁用按钮不派发 hover，故再包一层 span 承接提示 */}
            <Tooltip
              title={
                mergedLocals.length === 0
                  ? '当前没有可清理的已合并分支：当前分支与被工作树占用的分支不参与清理'
                  : `删除 ${mergedLocals.length} 个已合并到 HEAD 的本地分支：删除后不可恢复`
              }
            >
              <span>
                <Button
                  data-testid="cleanup-merged"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={mergedLocals.length === 0}
                  loading={acting}
                >
                  清理已合并（{mergedLocals.length}）
                </Button>
              </span>
            </Tooltip>
          </Popconfirm>
        ) : null}
        {/* 弹窗 Fetch（GitBranchPopupFetchAction 语义）：fetch 全部远程 → 容器重验证分支列表 */}
        {onFetch !== undefined ? (
          <Tooltip title="拉取全部远程更新：完成后容器重新校验分支列表，耗时取决于远端">
            <Button data-testid="branch-fetch" loading={fetching ?? acting} onClick={onFetch}>
              Fetch
            </Button>
          </Tooltip>
        ) : null}
      </Toolbar>

      {/* 最近检出组（GitBranchesPopup recent 组语义）：仅数据非空时渲染；行内「检出」→ 既有 branch 检出 */}
      {visibleRecent.length > 0 && (
        <BranchGroupCard
          title={`最近检出（${visibleRecent.length}${visibleRecent.length !== recentRefs.length ? `/${recentRefs.length}` : ''}）`}
          rows={visibleRecent.map((branch) => (
            <RecentBranchRow key={branch.name} branch={branch} onCheckout={onCheckout} />
          ))}
        />
      )}
      <BranchGroupCard
        title={`本地分支（${visibleLocals.length}${visibleLocals.length !== locals.length ? `/${locals.length}` : ''}）`}
        rows={
          visibleLocals.length === 0 ? (
            <Typography.Text type="secondary">
              {filterText.trim() !== '' || mergedOnly ? '无匹配的本地分支' : '无本地分支'}
            </Typography.Text>
          ) : (
            visibleLocals.map((branch) => (
              <LocalBranchRow
                key={branch.name}
                branch={branch}
                pendingDelete={pendingDelete}
                onMenuAction={handleMenuAction}
                onDelete={handleDelete}
                onDeleteCancel={() => setPendingDelete(null)}
                onCompare={onCompare}
                onForcePushedUpdate={onForcePushedUpdate}
                hasCheckoutRebase={onCheckoutRebase !== undefined}
                hasCheckoutUpdate={onCheckoutUpdate !== undefined}
                hasWorkingDiff={onShowDiffWithWorkingTree !== undefined}
              />
            ))
          )
        }
      />
      <BranchGroupCard
        title={`远程分支（${visibleRemotes.length}${visibleRemotes.length !== remotes.length ? `/${remotes.length}` : ''}）`}
        rows={
          visibleRemotes.length === 0 ? (
            <Typography.Text type="secondary">
              {filterText.trim() !== '' || mergedOnly ? '无匹配的远程分支' : '无远程分支'}
            </Typography.Text>
          ) : (
            visibleRemotes.map((branch) => (
              <RemoteBranchRow
                key={branch.name}
                branch={branch}
                hasCheckoutRebase={onCheckoutRebase !== undefined}
                onMenuAction={handleMenuAction}
              />
            ))
          )
        }
      />

      {/* 标签组（GitBranchesTreeSingleRepoModel tags 组语义）：仅注入 tags 且数据非空时渲染；行内「检出」→ detached */}
      {tags !== undefined && visibleTags.length > 0 && (
        <BranchGroupCard
          title={`标签（${visibleTags.length}${visibleTags.length !== tags.tags.length ? `/${tags.tags.length}` : ''}）`}
          rows={visibleTags.map((tag) => (
            <TagRow key={tag.name} tag={tag} onCheckout={onCheckout} />
          ))}
        />
      )}

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
      {/* 远程分支检出并变基：本地名 Modal（关闭即卸载复位；建议名 = 剥远程名前缀，改名预检由服务端兜底） */}
      {remoteRebaseTarget !== null && (
        <SingleInputModal
          key={remoteRebaseTarget}
          title={`检出并变基到当前：${remoteRebaseTarget}`}
          open
          acting={acting}
          placeholder="本地分支名"
          inputTestId="remote-rebase-input"
          initialValue={
            remoteRebaseTarget.includes('/') ? remoteRebaseTarget.replace(/^[^/]+\//, '') : remoteRebaseTarget
          }
          onSubmit={(localName) => {
            onCheckoutRebase?.({ branch: remoteRebaseTarget, localName });
          }}
          onClose={() => setRemoteRebaseTarget(null)}
        />
      )}
      {/* 与工作树差异 Modal（GitShowDiffWithRefAction 语义）：branch vs 当前工作树文件清单——行点击 →
          该文件 diff（?file=&from=<branch>）；数据由容器经 useBranchWorkingDiff 条件拉取 */}
      <Modal
        title={`与工作树差异（${workingDiffBranch === undefined || workingDiffBranch === '' ? '' : workingDiffBranch}）`}
        open={workingDiffBranch !== undefined && workingDiffBranch !== ''}
        okText="关闭"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={onCloseWorkingDiff}
        onCancel={onCloseWorkingDiff}
      >
        {workingDiffLoading ? (
          <Skeleton active />
        ) : workingDiffError !== undefined && workingDiffError !== null ? (
          <Alert type="error" showIcon title={workingDiffError} />
        ) : workingDiffData === undefined || workingDiffData === null ? (
          <Typography.Text type="secondary">暂无差异（工作树与分支一致）</Typography.Text>
        ) : (
          <Flex vertical gap={8}>
            {workingDiffData.files.map((file) => (
              <Flex key={`${file.status}-${file.path}`} align="center" gap={8}>
                <CommittedStatusTag status={file.status} />
                <Tooltip title={`打开该文件的差异视图：当前工作树与 ${workingDiffData.branch} 的逐行对比`}>
                  <Typography.Text
                    data-testid={`working-diff-file-${file.path}`}
                    style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
                    ellipsis
                    onClick={() => onOpenWorkingDiffFile?.(workingDiffData.branch, file.path)}
                  >
                    {file.renameFrom !== undefined ? `${file.renameFrom} → ${file.path}` : file.path}
                  </Typography.Text>
                </Tooltip>
              </Flex>
            ))}
          </Flex>
        )}
      </Modal>
    </Flex>
  );
}
