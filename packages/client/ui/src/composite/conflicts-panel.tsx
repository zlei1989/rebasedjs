/**
 * 冲突面板（对照 Java GitConflictsPanel）：
 *  冲突文件列表（路径 + 冲突类型徽标，由 stages 组合推导；按目录子标题分组）+ 行操作
 *  「用我们的」「用他们的」「手动合并」（手动合并开 MergeView，由容器承接）+ 底部「继续」按钮
 *  （文案按 operationKind 泛化：merge→完成合并、rebase→继续变基、cherry-pick→继续摘樱桃、
 *  revert→继续还原；全部解决后可用，否则禁用并 Tooltip 提示）。
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
  /** 跳过冲突中的操作（rebase --skip / cherry-pick|revert --skip 语义）；缺省不渲染「跳过」按钮（merge 无 skip 概念） */
  onSkip?: () => void;
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

/**
 * 按目录分组（容器/测试复用，单层——不递归子目录）：
 *  目录 = 路径的 dirname 部分（含 `/` 分隔），根目录归 `''` 键，展示为「根目录」；
 *  键按目录名排序、组内按路径排序（稳定顺序）。
 */
export function groupConflictsByDir(entries: ConflictEntry[]): Map<string, ConflictEntry[]> {
  const grouped = new Map<string, ConflictEntry[]>();
  for (const entry of entries) {
    const idx = entry.path.lastIndexOf('/');
    const dir = idx < 0 ? '' : entry.path.slice(0, idx);
    const bucket = grouped.get(dir);
    if (bucket) bucket.push(entry);
    else grouped.set(dir, [entry]);
  }
  for (const bucket of grouped.values()) bucket.sort((a, b) => (a.path < b.path ? -1 : 1));
  return new Map([...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/** 目录子标题文案：根目录显示「根目录」，其余显示目录名 + 计数 */
function dirLabel(dir: string, count: number): string {
  return dir === '' ? `根目录（${count}）` : `${dir}（${count}）`;
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
      {/* 「用我们的」：按我方版本整文件采纳（git checkout --ours，对侧改动随之丢弃）。
          禁用有两种原因（解决请求进行中 / 该侧无版本必失败），文案分别说明；
          禁用按钮不派发 hover（React 会抑制禁用控件的 onMouseEnter），故在 Tooltip 与 Button 之间
          包一层 span 承接提示；inline-flex 让 span 紧贴按钮，不改变原 Flex 行的布局尺寸 */}
      <Tooltip
        title={
          !hasOurs
            ? '我方没有该文件版本（对方删除或本次未改动），采纳必失败：需要用「删除该文件」解决'
            : resolving
              ? '冲突解决请求进行中，完成后再操作'
              : '采纳我方版本覆盖该文件（git checkout --ours）：对侧改动会被丢弃'
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            data-testid={`resolve-ours-${entry.path}`}
            disabled={resolving || !hasOurs}
            onClick={() => onResolve({ strategy: 'ours', path: entry.path })}
          >
            用我们的
          </Button>
        </span>
      </Tooltip>
      {/* 「用他们的」：同上，改为采纳对方版本（git checkout --theirs） */}
      <Tooltip
        title={
          !hasTheirs
            ? '对方没有该文件版本（我方删除或对方未改动），采纳必失败：需要用「删除该文件」解决'
            : resolving
              ? '冲突解决请求进行中，完成后再操作'
              : '采纳对方版本覆盖该文件（git checkout --theirs）：我方改动会被丢弃'
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            data-testid={`resolve-theirs-${entry.path}`}
            disabled={resolving || !hasTheirs}
            onClick={() => onResolve({ strategy: 'theirs', path: entry.path })}
          >
            用他们的
          </Button>
        </span>
      </Tooltip>
      {/* 删除/修改冲突（一侧无版本）：提供「保持删除」路径（git rm 语义） */}
      {!hasOurs || !hasTheirs ? (
        <Popconfirm
          title="确认以删除解决该冲突？"
          okText="确定"
          cancelText="取消"
          onConfirm={() => onResolve({ strategy: 'delete', path: entry.path })}
        >
          {/* Tooltip 放在 Popconfirm 内侧，保持 Popconfirm 的触发链完整（Popconfirm > Tooltip > Button）。
              此处刻意不插 span：禁用按钮自身的 onClick 被 React 抑制，而套上 span 会把 Popconfirm 的
              点击监听挪到 span 上，resolving 时点确认气泡仍会弹出并真的发出解决请求（行为变化） */}
          <Tooltip title="删除该文件以解决冲突（git rm 语义）：确认后文件从索引与工作区移除">
            <Button size="small" danger data-testid={`resolve-delete-${entry.path}`} disabled={resolving}>
              删除该文件
            </Button>
          </Tooltip>
        </Popconfirm>
      ) : null}
      {/* 「手动合并」：打开三方合并视图逐块取舍，不改动仓库状态 */}
      <Tooltip title={resolving ? '冲突解决请求进行中，完成后再操作' : '打开手动合并视图：逐块选择保留双方内容，存盘后再回本页继续'}>
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            data-testid={`merge-manual-${entry.path}`}
            disabled={resolving}
            onClick={() => onOpenMergeView(entry.path)}
          >
            手动合并
          </Button>
        </span>
      </Tooltip>
    </Flex>
  );
}

export function ConflictsPanel({
  conflicts,
  onResolve,
  onOpenMergeView,
  onContinue,
  onSkip,
  resolving,
  continuing,
  operationKind,
}: ConflictsPanelProps): React.ReactNode {
  const remaining = conflicts.conflicts.length;
  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Card size="small" title={`冲突文件（${remaining}）`}>
        {/* 行列表用 Flex vertical 渲染（antd v6 已弃用 List）；按目录子标题分组（单层） */}
        <Flex vertical>
          {remaining === 0 ? (
            <Typography.Text type="secondary">无冲突</Typography.Text>
          ) : (
            [...groupConflictsByDir(conflicts.conflicts).entries()].map(([dir, entries]) => (
              <Flex vertical key={dir}>
                <Typography.Text
                  type="secondary"
                  data-testid={`conflict-dir-${dir === '' ? '(root)' : dir}`}
                  style={{ padding: '4px 0' }}
                >
                  {dirLabel(dir, entries.length)}
                </Typography.Text>
                {entries.map((entry) => (
                  <ConflictRow
                    key={entry.path}
                    entry={entry}
                    resolving={resolving}
                    onResolve={onResolve}
                    onOpenMergeView={onOpenMergeView}
                  />
                ))}
              </Flex>
            ))
          )}
        </Flex>
      </Card>
      {/* continue：仅在全部解决后可用；未解决时禁用 + Tooltip 提示原因。
          文案按 operationKind 泛化（merge/rebase/cherry-pick/revert），缺省 merge。
          禁用按钮不派发 hover 事件，按 antd 官方做法在 Tooltip 与 Button 间包一层 span 承接提示。
          「跳过」：rebase/cherry-pick/revert 冲突时可用（丢弃当前不适用变更继续后续——onSkip 提供才渲染） */}
      <Flex justify="flex-end" gap={8}>
        {onSkip !== undefined && (
          <Popconfirm
            title="跳过当前提交（其变更将被丢弃）？"
            okText="确定"
            cancelText="取消"
            onConfirm={onSkip}
          >
            {/* Tooltip 在内、Popconfirm 在外；不插 span 的原因同「删除该文件」——避免禁用态下
                Popconfirm 的点击链被挪到 span 上而仍能弹出确认 */}
            <Tooltip title="放弃当前这一提交的变更并继续后续流程（skip 语义，被丢弃的改动不可恢复）">
              <Button data-testid="skip-operation" disabled={remaining === 0}>
                跳过
              </Button>
            </Tooltip>
          </Popconfirm>
        )}
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
