/**
 * 冲突面板（对照 Java GitConflictsPanel）：
 *  冲突文件列表（路径 + 冲突类型徽标，由 stages 组合推导）+ 行操作「用我们的」「用他们的」「手动合并」
 *  （手动合并开 MergeView，由容器承接）+ 底部「继续」按钮（文案按 operationKind 泛化：
 *  merge→完成合并、rebase→继续变基、cherry-pick→继续摘樱桃、revert→继续还原；全部解决后可用，否则禁用并 Tooltip 提示）。
 *  删除/修改冲突（stages 缺 2 或 3）：对应整侧采纳按钮禁用（该侧无版本，checkout 必失败），
 *  并额外渲染「删除该文件」（Popconfirm 确认；对照 Java 版把采纳映射为删除的路径）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入。
 */
import { Button, Card, Flex, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import type { ConflictEntry, ConflictList, OperationKind, ResolveConflictBody } from '@rebased/contracts';

export interface ConflictsPanelProps {
  conflicts: ConflictList;
  onResolve: (body: ResolveConflictBody) => void;
  onOpenMergeView: (path: string) => void;
  onContinue: () => void;
  /** 解决请求进行中：行操作按钮禁用 */
  resolving?: boolean;
  /** 完成合并请求进行中：底部按钮 loading 态 */
  continuing?: boolean;
  /** 进行中操作种类：continue 按钮文案按种类泛化；缺省按 merge 处理（历史行为向后兼容） */
  operationKind?: OperationKind;
}

/**
 * continue 按钮文案（容器/测试复用）：按 operation kind 映射——
 * merge→完成合并、rebase→继续变基、cherry-pick→继续摘樱桃、revert→继续还原；缺省/其他一律按 merge。
 */
export function continueKindLabel(kind?: OperationKind): string {
  switch (kind) {
    case 'rebase':
      return '继续变基';
    case 'cherry-pick':
      return '继续摘樱桃';
    case 'revert':
      return '继续还原';
    default:
      return '完成合并';
  }
}

/**
 * 冲突类型徽标文案（容器/测试复用）：stages 为存在的阶段编号（1=base 共同祖先，2=ours 我方，3=theirs 对方）。
 *  [1,2,3]=双方修改、[2,3]=双方新增、[1,2]=对方删除/我方修改、[1,3]=我方删除/对方修改、其他=冲突。
 *  对输入乱序鲁棒：先排序再按组合比对。
 */
export function conflictKindLabel(stages: number[]): string {
  const key = [...stages].sort((a, b) => a - b).join(',');
  if (key === '1,2,3') return '双方修改';
  if (key === '2,3') return '双方新增';
  if (key === '1,2') return '对方删除/我方修改';
  if (key === '1,3') return '我方删除/对方修改';
  return '冲突';
}

/** 冲突文件行：路径 + 类型徽标 + 行尾操作（用我们的/用他们的/手动合并；删除/修改冲突加「删除该文件」） */
function ConflictRow({
  entry,
  resolving,
  onResolve,
  onOpenMergeView,
}: {
  entry: ConflictEntry;
  resolving?: boolean;
  onResolve: (body: ResolveConflictBody) => void;
  onOpenMergeView: (path: string) => void;
}): React.ReactNode {
  // 某侧无版本（stages 缺 2/3）时对应采纳按钮禁用：git checkout --ours/--theirs 必失败
  const hasOurs = entry.stages.includes(2);
  const hasTheirs = entry.stages.includes(3);
  return (
    <Flex data-testid={`conflict-row-${entry.path}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {entry.path}
      </Typography.Text>
      <Tag color="red">{conflictKindLabel(entry.stages)}</Tag>
      <Button
        size="small"
        data-testid={`resolve-ours-${entry.path}`}
        disabled={resolving || !hasOurs}
        onClick={() => onResolve({ strategy: 'ours', path: entry.path })}
      >
        用我们的
      </Button>
      <Button
        size="small"
        data-testid={`resolve-theirs-${entry.path}`}
        disabled={resolving || !hasTheirs}
        onClick={() => onResolve({ strategy: 'theirs', path: entry.path })}
      >
        用他们的
      </Button>
      {/* 删除/修改冲突（一侧无版本）：提供「保持删除」路径（git rm 语义） */}
      {!hasOurs || !hasTheirs ? (
        <Popconfirm
          title="确认以删除解决该冲突？"
          okText="确定"
          cancelText="取消"
          onConfirm={() => onResolve({ strategy: 'delete', path: entry.path })}
        >
          <Button size="small" danger data-testid={`resolve-delete-${entry.path}`} disabled={resolving}>
            删除该文件
          </Button>
        </Popconfirm>
      ) : null}
      <Button
        size="small"
        data-testid={`merge-manual-${entry.path}`}
        disabled={resolving}
        onClick={() => onOpenMergeView(entry.path)}
      >
        手动合并
      </Button>
    </Flex>
  );
}

export function ConflictsPanel({
  conflicts,
  onResolve,
  onOpenMergeView,
  onContinue,
  resolving,
  continuing,
  operationKind,
}: ConflictsPanelProps): React.ReactNode {
  const remaining = conflicts.conflicts.length;
  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Card size="small" title={`冲突文件（${remaining}）`}>
        {/* 行列表用 Flex vertical 渲染（antd v6 已弃用 List），行结构对齐 status-page 的 Flex 行约定 */}
        <Flex vertical>
          {remaining === 0 ? (
            <Typography.Text type="secondary">无冲突</Typography.Text>
          ) : (
            conflicts.conflicts.map((entry) => (
              <ConflictRow
                key={entry.path}
                entry={entry}
                resolving={resolving}
                onResolve={onResolve}
                onOpenMergeView={onOpenMergeView}
              />
            ))
          )}
        </Flex>
      </Card>
      {/* continue：仅在全部解决后可用；未解决时禁用 + Tooltip 提示原因。
          文案按 operationKind 泛化（merge/rebase/cherry-pick/revert），缺省 merge。
          禁用按钮不派发 hover 事件，按 antd 官方做法在 Tooltip 与 Button 间包一层 span 承接提示 */}
      <Flex justify="flex-end">
        <Tooltip title={remaining > 0 ? '还有未解决的冲突' : undefined}>
          <span data-testid="continue-merge-wrap">
            <Button
              type="primary"
              disabled={remaining > 0}
              loading={continuing}
              onClick={onContinue}
            >
              {continueKindLabel(operationKind)}
            </Button>
          </span>
        </Tooltip>
      </Flex>
    </Flex>
  );
}
