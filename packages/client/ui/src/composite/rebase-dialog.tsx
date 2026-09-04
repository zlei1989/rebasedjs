/**
 * 交互式变基对话框（对照 Java GitInteractiveRebaseDialog + GitRebaseCommitsTableView）：
 *  两种模式（Radio 切换）：简单模式（onto 输入 + 开始）与交互模式（todo 列表编辑——
 *  短哈希 + subject + 动作 Select（pick/reword/squash/fixup/drop）+ 上移/下移按钮，
 *  首行禁上移、末行禁下移——对照 Java 的排序约束）。
 *  纯受控组件：open 由父级持有；todo 数据由容器按 base 注入（useRebaseTodo，
 *  base 输入变化经 onBaseChange 让容器重取）；行序/动作/输入为本地状态，关闭或提交后复位。
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Button, Flex, Input, Modal, Radio, Select, Spin, Typography } from 'antd';
import type { RebaseBody, RebaseTodoAction, TodoEntry } from '@rebased/contracts';

export interface RebaseDialogProps {
  open: boolean;
  /** 简单模式提交 */
  onRebaseOnto: (body: RebaseBody) => void;
  /** 交互模式数据源（容器按 base 注入） */
  todo?: TodoEntry[];
  todoLoading?: boolean;
  /** 交互模式 todo 加载失败信息（容器透传 useRebaseTodo 的 error.message）：
   *  非空时渲染错误文案替代「无待重放提交」并禁用确定——无效 base 不能再以误导性空列表呈现 */
  todoError?: string;
  /** 交互模式提交（entries 为编辑后全量列表，顺序即新顺序） */
  onInteractiveRebase: (body: { base: string; entries: { hash: string; action: RebaseTodoAction }[] }) => void;
  onCancel: () => void;
  confirming?: boolean;
  /** 交互模式的 base 引用（容器已知，回传用） */
  base?: string;
  /** 交互模式基准输入变化回调（容器据新 base 重取 todo 并回注 base） */
  onBaseChange?: (base: string) => void;
}

/** 对话框模式：简单（onto 直启）/ 交互（todo 编辑器） */
type RebaseMode = 'simple' | 'interactive';

/** 交互行编辑态：数据源（哈希+subject）+ 当前动作 */
interface RebaseRow {
  hash: string;
  subject: string;
  action: RebaseTodoAction;
}

/** 动作选项：值与 git rebase -i 命令名一致，行内直接展示命令名 */
const ACTION_OPTIONS: { value: RebaseTodoAction; label: RebaseTodoAction }[] = [
  { value: 'pick', label: 'pick' },
  { value: 'reword', label: 'reword' },
  { value: 'squash', label: 'squash' },
  { value: 'fixup', label: 'fixup' },
  { value: 'drop', label: 'drop' },
];

/** 依据数据源生成初始行：动作默认 pick（重排/换动作前的基线） */
function buildRows(todo: TodoEntry[] | undefined): RebaseRow[] {
  return (todo ?? []).map((entry) => ({ hash: entry.hash, subject: entry.subject, action: 'pick' }));
}

/** 单行 todo 编辑：短哈希 + subject + 动作 Select + 上移/下移按钮（首末行边界禁用） */
function TodoRow({
  row,
  index,
  total,
  onMove,
  onActionChange,
}: {
  row: RebaseRow;
  index: number;
  total: number;
  onMove: (hash: string, delta: -1 | 1) => void;
  onActionChange: (hash: string, action: RebaseTodoAction) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`todo-row-${row.hash}`} align="center" gap={8} style={{ padding: '2px 0' }}>
      <Typography.Text code style={{ flexShrink: 0 }}>
        {row.hash.slice(0, 8)}
      </Typography.Text>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {row.subject}
      </Typography.Text>
      <Select
        data-testid={`todo-action-${row.hash}`}
        size="small"
        style={{ width: 96, flexShrink: 0 }}
        value={row.action}
        options={ACTION_OPTIONS}
        onChange={(action) => onActionChange(row.hash, action)}
      />
      <Button
        size="small"
        type="text"
        icon={<ArrowUpOutlined />}
        aria-label="上移"
        data-testid={`todo-up-${row.hash}`}
        disabled={index === 0}
        onClick={() => onMove(row.hash, -1)}
      />
      <Button
        size="small"
        type="text"
        icon={<ArrowDownOutlined />}
        aria-label="下移"
        data-testid={`todo-down-${row.hash}`}
        disabled={index === total - 1}
        onClick={() => onMove(row.hash, 1)}
      />
    </Flex>
  );
}

export function RebaseDialog(props: RebaseDialogProps): React.ReactNode {
  const {
    open,
    onRebaseOnto,
    todo,
    todoLoading,
    todoError,
    onInteractiveRebase,
    onCancel,
    confirming,
    base,
    onBaseChange,
  } = props;

  const [mode, setMode] = useState<RebaseMode>('simple');
  const [onto, setOnto] = useState('');
  const [rows, setRows] = useState<RebaseRow[]>(() => buildRows(todo));

  /** 数据源内容键（hash 集合）：base 切换必然换内容；同内容重取（SWR 引用变化）不打断用户编辑 */
  const todoKey = useMemo(() => (todo ?? []).map((entry) => entry.hash).join('\n'), [todo]);

  /** 数据源变化（哈希集合变化）时重建交互行并复位动作：容器按新 base 注入新 todo */
  useEffect(() => {
    setRows(buildRows(todo));
  }, [todoKey]);

  /** 交互模式可提交：基准非空、有行、非全部 drop、无加载失败（全 drop 的重放无意义，服务端也不接受空清单） */
  const interactiveOk =
    (base ?? '').trim() !== '' && rows.length > 0 && rows.some((row) => row.action !== 'drop') && !todoError;

  /** 复位全部内部状态（关闭后重开时）：模式回简单、输入清空、行回数据源基线 */
  const reset = (): void => {
    setMode('simple');
    setOnto('');
    setRows(buildRows(todo));
  };

  /** 关闭 → 打开的每次转换都复位：容器在成功/冲突/取消时关窗，下次打开重新开始；
   *  提交动作本身不复位——失败时容器保持打开，编辑须保留供用户改参重试（P3-B 终审修复） */
  useEffect(() => {
    if (open) reset();
  }, [open]);

  /** 取消：先复位再通知父级（Modal 默认不卸载子树，重开不能残留上次编辑） */
  const close = (): void => {
    reset();
    onCancel();
  };

  /** 简单模式提交：onto 去空白后传出 {onto}（编辑保留，复位归关窗时机） */
  const submitSimple = (): void => {
    if (onto.trim() === '') return;
    onRebaseOnto({ onto: onto.trim() });
  };

  /** 交互模式提交：entries 为编辑后的全量列表（顺序即新顺序），base 来自 props（编辑保留，复位归关窗时机） */
  const submitInteractive = (): void => {
    if (!interactiveOk) return;
    onInteractiveRebase({
      base: (base ?? '').trim(),
      entries: rows.map(({ hash, action }) => ({ hash, action })),
    });
  };

  /** 上移/下移：与相邻行交换（delta=-1 上移）；越界（首/末行）不作变更——对照 Java 排序约束；
   *  函数式更新保证连续点击基于最新顺序计算目标位置 */
  const move = (hash: string, delta: -1 | 1): void => {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.hash === hash);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /** 动作变更：按哈希定位行更新动作 */
  const changeAction = (hash: string, action: RebaseTodoAction): void => {
    setRows((prev) => prev.map((row) => (row.hash === hash ? { ...row, action } : row)));
  };

  return (
    <Modal
      title="变基"
      open={open}
      okText={mode === 'simple' ? '开始' : '确定'}
      cancelText="取消"
      // 交互模式在 todoLoading 期间也禁用：SWR 换 base 重取时本地仍有旧行，不得拿旧行提交新 base（Task 6 审查防御）
      okButtonProps={{ disabled: mode === 'simple' ? onto.trim() === '' : !interactiveOk || !!todoLoading }}
      confirmLoading={confirming}
      onOk={mode === 'simple' ? submitSimple : submitInteractive}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as RebaseMode)}>
          <Flex gap={16}>
            <Radio value="simple">简单</Radio>
            <Radio value="interactive">交互</Radio>
          </Flex>
        </Radio.Group>
        {mode === 'simple' ? (
          <Flex vertical gap={4}>
            <Typography.Text type="secondary">目标（onto）：</Typography.Text>
            <Input
              data-testid="rebase-onto"
              placeholder="如 main、HEAD~2 或提交哈希"
              value={onto}
              onChange={(e) => setOnto(e.target.value)}
            />
          </Flex>
        ) : (
          <Flex vertical gap={8}>
            <Flex align="center" gap={8}>
              <Typography.Text type="secondary">基准（base）：</Typography.Text>
              <Input
                data-testid="rebase-base"
                placeholder="如 main（base..HEAD 的提交将重放）"
                value={base ?? ''}
                onChange={(e) => onBaseChange?.(e.target.value)}
              />
            </Flex>
            {todoLoading ? (
              <Spin data-testid="rebase-todo-loading" />
            ) : todoError ? (
              <Typography.Text type="danger" data-testid="rebase-todo-error">
                {todoError}
              </Typography.Text>
            ) : rows.length === 0 ? (
              <Typography.Text type="secondary">无待重放提交（base..HEAD 为空）</Typography.Text>
            ) : (
              <Flex vertical gap={4} style={{ maxHeight: 320, overflow: 'auto' }}>
                {rows.map((row, index) => (
                  <TodoRow
                    key={row.hash}
                    row={row}
                    index={index}
                    total={rows.length}
                    onMove={move}
                    onActionChange={changeAction}
                  />
                ))}
              </Flex>
            )}
            {/* squash/fixup 语义提示（不强制约束：「squash 会并入上一非 drop 行」——对照 Java 交互提示） */}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              提示：squash 会并入上一非 drop 行（提交信息保留）；fixup 会并入上一非 drop 行并丢弃提交信息；
              drop 将移除该提交。
            </Typography.Text>
          </Flex>
        )}
      </Flex>
    </Modal>
  );
}
