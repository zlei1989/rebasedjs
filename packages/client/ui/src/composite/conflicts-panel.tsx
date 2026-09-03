/**
 * 冲突面板（对照 Java GitConflictsPanel）：
 *  冲突文件列表（路径 + 冲突类型徽标，由 stages 组合推导）+ 行操作「用我们的」「用他们的」「手动合并」
 *  （手动合并开 MergeView，由容器承接）+ 底部「完成合并」按钮（全部解决后可用，否则禁用并 Tooltip 提示）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入。
 */
import { Button, Card, Flex, Tag, Tooltip, Typography } from 'antd';
import type { ConflictEntry, ConflictList, ResolveConflictBody } from '@rebased/contracts';

export interface ConflictsPanelProps {
  conflicts: ConflictList;
  onResolve: (body: ResolveConflictBody) => void;
  onOpenMergeView: (path: string) => void;
  onContinue: () => void;
  /** 解决请求进行中：行操作按钮禁用 */
  resolving?: boolean;
  /** 完成合并请求进行中：底部按钮 loading 态 */
  continuing?: boolean;
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

/** 冲突文件行：路径 + 类型徽标 + 行尾操作（用我们的/用他们的/手动合并） */
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
  return (
    <Flex data-testid={`conflict-row-${entry.path}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {entry.path}
      </Typography.Text>
      <Tag color="red">{conflictKindLabel(entry.stages)}</Tag>
      <Button
        size="small"
        data-testid={`resolve-ours-${entry.path}`}
        disabled={resolving}
        onClick={() => onResolve({ strategy: 'ours', path: entry.path })}
      >
        用我们的
      </Button>
      <Button
        size="small"
        data-testid={`resolve-theirs-${entry.path}`}
        disabled={resolving}
        onClick={() => onResolve({ strategy: 'theirs', path: entry.path })}
      >
        用他们的
      </Button>
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
      {/* 完成合并：仅在全部解决后可用；未解决时禁用 + Tooltip 提示原因。
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
              完成合并
            </Button>
          </span>
        </Tooltip>
      </Flex>
    </Flex>
  );
}
