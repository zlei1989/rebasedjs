/**
 * 状态页（Local Changes + 暂存区 + 提交框）：
 *  变更按 porcelain XY 码分三组——已暂存（X ∈ MADRC）、工作区（Y ∈ MDT）、未跟踪（??；!! 已忽略条目不展示）。
 *  可选 changelists：提供时三组内再按变更列表子分组（默认列表平铺，非默认列表以列表名子标题分组），
 *  并开启行级「移动到列表」与页头「管理列表」（新建/重命名/设默认/删除）入口。
 *  补丁预览：选中文件显示 unified diff；onHunkStaging 提供时开启行内 hunk 选择（勾选 hunk →
 *  暂存/取消暂存/放弃选中，与文件级操作并行），切片经 contracts 共享函数（服务端索引同源）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入 hooks。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Dropdown,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Tag,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import { patchHunkHeading, splitPatchHunks } from '@rebased/contracts';
import type {
  Changelist,
  ChangelistAction,
  ChangelistView,
  ChangeEntry,
  CommitBody,
  DiffFile,
  HunkStagingBody,
  RepoStatus,
} from '@rebased/contracts';

export interface StatusPageProps {
  status: RepoStatus;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onCommit: (body: CommitBody) => void;
  committing?: boolean;
  /** 行内补丁预览：返回该文件的 unified 全文数据与加载态（容器接 useDiffPatch 按选中文件取数） */
  patch?: DiffFile;
  patchLoading?: boolean;
  /** 补丁预览的取数模式（true=暂存区 diff，false=工作区 diff）：决定 hunk 操作按钮组（unstage vs stage/discard） */
  previewStaged?: boolean;
  /** 行内 hunk 操作回调（body 为 hunk 级暂存请求）；提供时补丁预览按 hunk 切片渲染可选行 */
  onHunkStaging?: (body: HunkStagingBody) => void;
  /** hunk 操作进行中：操作按钮 loading 与禁用 */
  hunkActing?: boolean;
  onSelectPatch?: (path: string, staged: boolean) => void;
  /** 跳 diff 页（行双击或"查看对比"按钮） */
  onOpenDiff?: (path: string, staged: boolean) => void;
  /** 变更列表视图：提供时三组内按 changelist 子分组（缺省维持现状三分组，向后兼容） */
  changelists?: ChangelistView;
  /** 列表管理（新建/重命名/删除/设默认）与条目「移动到列表」回调；与 changelists 同时提供才生效 */
  onChangelistAction?: (action: ChangelistAction) => void;
  /** 行内「忽略」入口（未跟踪组）：未传时不渲染该按钮（向后兼容） */
  onIgnore?: (path: string) => void;
}

/** porcelain X 码（暂存区列）：M/A/D/R/C 视为已暂存 */
const STAGED_X = 'MADRC';
/** porcelain Y 码（工作区列）：M/D/T 视为工作区未暂存 */
const UNSTAGED_Y = 'MDT';

/** 分组结果：staged 已暂存、unstaged 工作区、untracked 未跟踪 */
export interface GroupedChanges {
  staged: ChangeEntry[];
  unstaged: ChangeEntry[];
  untracked: ChangeEntry[];
}

/**
 * 按 porcelain XY 码分组（容器/测试复用）：
 *  `!!` 已忽略丢弃；`??` 入 untracked；X ∈ MADRC 入 staged；Y ∈ MDT 入 unstaged。
 *  注意同一条目可能同时入 staged 与 unstaged（X、Y 都有效，如 `MM`），与 git status 短格式双列语义一致。
 */
export function groupChanges(entries: ChangeEntry[]): GroupedChanges {
  const grouped: GroupedChanges = { staged: [], unstaged: [], untracked: [] };
  for (const entry of entries) {
    if (entry.code === '!!') continue;
    if (entry.code === '??') {
      grouped.untracked.push(entry);
      continue;
    }
    if (STAGED_X.includes(entry.code[0] ?? '')) grouped.staged.push(entry);
    if (UNSTAGED_Y.includes(entry.code[1] ?? '')) grouped.unstaged.push(entry);
  }
  return grouped;
}

/** 变更列表分组键：非默认列表用 listId，默认列表固定 'default'（含未指派、孤儿指派、显式指向默认列表） */
const DEFAULT_KEY = 'default';

/**
 * 解析路径的当前分组键：未指派、孤儿指派（目标列表已删除）、显式指向默认列表均归 'default'；
 *  其余归其 listId。行级「移动到列表」的"当前列表"判定与 groupByChangelist 共用此规则。
 */
function resolveChangelistKey(path: string, view: ChangelistView): string {
  const assigned = view.assignments[path];
  if (assigned === undefined) return DEFAULT_KEY;
  const list = view.lists.find((l) => l.id === assigned);
  if (list === undefined || list.isDefault) return DEFAULT_KEY;
  return list.id;
}

/**
 * 按变更列表分组（容器/测试复用）：键为 listId 或 'default'。
 *  孤儿指派回退 'default'——assignments 读取时虽已修剪，但视图与 status 可能不是同一次刷新，UI 层仍兜底。
 */
export function groupByChangelist(entries: ChangeEntry[], view: ChangelistView): Map<string, ChangeEntry[]> {
  const grouped = new Map<string, ChangeEntry[]>();
  for (const entry of entries) {
    const key = resolveChangelistKey(entry.path, view);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }
  return grouped;
}

/** 三组内部标识：决定徽标取码（staged 取 X 列、unstaged 取 Y 列、untracked 无码）与 onSelectPatch 的 staged 参数 */
type ChangeGroupKind = 'staged' | 'unstaged' | 'untracked';

/** 行内 code 徽标：取该组语义对应的列字符（重命名 R、新增 A、修改 M、删除 D、类型变更 T、未跟踪 ?） */
function codeBadge(entry: ChangeEntry, group: ChangeGroupKind): string {
  if (group === 'staged') return entry.code[0] ?? '?';
  if (group === 'unstaged') return entry.code[1] ?? '?';
  return '?';
}

/** 变更组卡片：组头"全选"Checkbox + 组级操作按钮（Card extra）+ 行列表（Checkbox + 路径 + code 徽标）；提供 changelists 时组内按列表子分组 */
function ChangeGroup({
  title,
  group,
  entries,
  onSelectPatch,
  onOpenDiff,
  actions,
  changelists,
  onChangelistAction,
  onIgnore,
}: {
  title: string;
  group: ChangeGroupKind;
  entries: ChangeEntry[];
  onSelectPatch?: (path: string, staged: boolean) => void;
  onOpenDiff?: (path: string, staged: boolean) => void;
  /** 组级操作按钮渲染器：接收当前勾选路径，未勾选时按钮应禁用 */
  actions: (selected: string[]) => React.ReactNode;
  changelists?: ChangelistView;
  onChangelistAction?: (action: ChangelistAction) => void;
  /** 行内「忽略」入口：仅未跟踪组渲染（缺省不渲染，向后兼容） */
  onIgnore?: (path: string) => void;
}): React.ReactNode {
  const [selected, setSelected] = useState<string[]>([]);
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const allChecked = entries.length > 0 && selected.length === entries.length;

  /** 组内变更列表子分组：仅在提供 changelists 时计算 */
  const byChangelist = useMemo(
    () => (changelists ? groupByChangelist(entries, changelists) : null),
    [entries, changelists],
  );

  /** 行勾选切换：维护本组勾选路径集合（行选中预览与勾选互不影响） */
  const toggle = (path: string, checked: boolean): void => {
    setSelected((prev) => (checked ? [...prev, path] : prev.filter((p) => p !== path)));
  };

  /** 单行渲染：勾选 + 路径 + code 徽标 +（可选）「移动到列表」行操作 */
  const renderRow = (entry: ChangeEntry): React.ReactNode => {
    /** 移动目标 = 非当前列表（当前在默认列表时可移往各普通列表，反之含默认列表） */
    const moveTargets: Changelist[] =
      changelists === undefined
        ? []
        : changelists.lists.filter((l) => resolveChangelistKey(entry.path, changelists) !== (l.isDefault ? DEFAULT_KEY : l.id));

    /** 移动分派：行已勾选时按当前选中集合批量移动，否则仅移动该行 */
    const move = (targetId: string): void => {
      const movePaths = selected.includes(entry.path) ? selected : [entry.path];
      onChangelistAction?.({ action: 'move', paths: movePaths, targetId });
    };

    return (
      <Flex
        key={entry.path}
        data-testid={`row-${group}-${entry.path}`}
        align="center"
        gap={8}
        style={{ cursor: 'pointer', padding: '4px 0' }}
        onClick={() => onSelectPatch?.(entry.path, group === 'staged')}
        onDoubleClick={() => onOpenDiff?.(entry.path, group === 'staged')}
      >
        {/* 勾选不应触发行选中预览：阻止点击冒泡到行 */}
        <Flex onClick={(e) => e.stopPropagation()}>
          <Checkbox
            data-testid={`check-${group}-${entry.path}`}
            checked={selected.includes(entry.path)}
            onChange={(e) => toggle(entry.path, e.target.checked)}
          />
        </Flex>
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {entry.path}
        </Typography.Text>
        <Tag>{codeBadge(entry, group)}</Tag>
        {/* 「移动到列表」行操作：仅 changelists 模式渲染；无可用目标（仅默认列表且在默认列表）时禁用 */}
        {changelists !== undefined && onChangelistAction !== undefined && (
          <Flex onClick={(e) => e.stopPropagation()}>
            <Dropdown
              trigger={['click']}
              disabled={moveTargets.length === 0}
              menu={{
                items: moveTargets.map((l) => ({ key: l.id, label: l.name })),
                onClick: ({ key }) => move(key),
              }}
            >
              <Button size="small" type="text" data-testid={`move-${group}-${entry.path}`}>
                移动到列表
              </Button>
            </Dropdown>
          </Flex>
        )}
        {/* 「忽略」行操作：仅未跟踪组渲染（缺省不渲染，向后兼容）；点击不触发行选中 */}
        {group === 'untracked' && onIgnore !== undefined && (
          <Flex onClick={(e) => e.stopPropagation()}>
            <Button size="small" type="text" data-testid={`ignore-${group}-${entry.path}`} onClick={() => onIgnore(entry.path)}>
              忽略
            </Button>
          </Flex>
        )}
      </Flex>
    );
  };

  return (
    <Card
      size="small"
      title={`${title}（${entries.length}）`}
      extra={
        <Flex align="center" gap={8}>
          <Checkbox
            data-testid={`select-all-${group}`}
            checked={allChecked}
            indeterminate={selected.length > 0 && !allChecked}
            onChange={(e) => setSelected(e.target.checked ? paths : [])}
          >
            全选
          </Checkbox>
          {actions(selected)}
        </Flex>
      }
    >
      {/* 行列表用 Flex 渲染：antd v6 已弃用 List（控制台告警），行结构对齐 settings-page 的 Flex 行约定 */}
      <Flex vertical>
        {entries.length === 0 ? (
          <Typography.Text type="secondary">无变更</Typography.Text>
        ) : byChangelist === null || changelists === undefined ? (
          entries.map(renderRow)
        ) : (
          <>
            {/* 默认列表条目平铺在前（无子标题），非默认列表按列表名子标题分组在后 */}
            {(byChangelist.get(DEFAULT_KEY) ?? []).map(renderRow)}
            {changelists.lists
              .filter((l) => !l.isDefault)
              .map((list) => {
                const listEntries = byChangelist.get(list.id) ?? [];
                if (listEntries.length === 0) return null;
                return (
                  <Flex vertical key={list.id}>
                    <Typography.Text
                      type="secondary"
                      data-testid={`subtitle-${group}-${list.id}`}
                      style={{ padding: '4px 0' }}
                    >
                      {list.name}（{listEntries.length}）
                    </Typography.Text>
                    {listEntries.map(renderRow)}
                  </Flex>
                );
              })}
          </>
        )}
      </Flex>
    </Card>
  );
}

/** 列表名单输入 Modal：新建/重命名复用（标题与输入 testid 由调用方区分，提交回调组装 action） */
function ChangelistNameModal({
  title,
  open,
  inputTestId,
  onSubmit,
  onClose,
}: {
  title: string;
  open: boolean;
  inputTestId: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');

  /** 关闭时清空输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setName('');
    onClose();
  };

  const submit = (): void => {
    onSubmit(name.trim());
    close();
  };

  return (
    <Modal
      title={title}
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' }}
      onOk={submit}
      onCancel={close}
    >
      <Input
        data-testid={inputTestId}
        placeholder="列表名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </Modal>
  );
}

/** 提交框卡片：TextArea（自适应行数）+ amend/signOff/noVerify + primary 提交按钮 */
function CommitCard({
  committing,
  onCommit,
}: {
  committing?: boolean;
  onCommit: (body: CommitBody) => void;
}): React.ReactNode {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [noVerify, setNoVerify] = useState(false);

  /** 组装提交体：仅在为 true 时带可选标志（契约 CommitBody 均为 optional，避免传冗余 false） */
  const submit = (): void => {
    const body: CommitBody = { message: message.trim() };
    if (amend) body.amend = true;
    if (signOff) body.signOff = true;
    if (noVerify) body.noVerify = true;
    onCommit(body);
  };

  return (
    <Card size="small" title="提交">
      <Flex vertical gap={8}>
        <Input.TextArea
          data-testid="commit-message"
          autoSize={{ minRows: 2, maxRows: 6 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          // amend 必须给新 message（服务端 git commit --amend -m），留空不沿用原 message
          placeholder={amend ? '修改上一次提交的提交信息' : '提交信息'}
        />
        <Flex align="center" gap={16}>
          <Checkbox checked={amend} onChange={(e) => setAmend(e.target.checked)}>
            amend
          </Checkbox>
          <Checkbox checked={signOff} onChange={(e) => setSignOff(e.target.checked)}>
            signOff
          </Checkbox>
          <Checkbox checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)}>
            noVerify
          </Checkbox>
          <Button
            type="primary"
            data-testid="commit-button"
            loading={committing}
            disabled={message.trim() === ''}
            onClick={submit}
          >
            提交
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}

/**
 * 补丁预览卡片：onHunkStaging 提供时按 hunk 切片渲染（勾选 + 头行标题 + 折叠正文），
 * 顶栏动作按 previewStaged 分流（已暂存视图→取消暂存；工作区视图→暂存/放弃），
 * 提交体 file 取 patch.path、hunks 取勾选索引（与服务端切片同源——contracts splitPatchHunks）。
 * 兜底：无 hunk（空 diff/头部-only）或未接 hunk 回调时回退纯文本渲染（原行为）。
 */
function PatchCard({
  patch,
  patchLoading,
  previewStaged = false,
  onHunkStaging,
  hunkActing,
}: {
  patch?: DiffFile;
  patchLoading?: boolean;
  previewStaged?: boolean;
  onHunkStaging?: (body: HunkStagingBody) => void;
  hunkActing?: boolean;
}): React.ReactNode {
  const [selected, setSelected] = useState<number[]>([]);
  const split = useMemo(() => (patch ? splitPatchHunks(patch.text) : null), [patch]);
  // 文件或补丁文本变化时复位勾选：hunk 索引按当前 diff 编号（部分暂存后服务端重算编号，旧勾选会错位）
  useEffect(() => {
    setSelected([]);
  }, [patch?.path, patch?.text]);

  const hunkMode = onHunkStaging !== undefined && split !== null && split.hunks.length > 0;
  /** 勾选切换：选中集为当前 hunk 索引数组（有序提交，索引越界由服务端校验兜底） */
  const toggle = (index: number, checked: boolean): void => {
    setSelected((prev) => (checked ? [...prev, index] : prev.filter((i) => i !== index)));
  };
  /** 动作分派：按预览模式给 body（unstage 见已暂存、stage/discard 见工作区） */
  const fire = (action: HunkStagingBody['action']): void => {
    if (patch === undefined || selected.length === 0) return;
    onHunkStaging?.({ action, file: patch.path, hunks: selected });
  };

  return (
    <Card size="small" title={patch ? `补丁预览：${patch.path}` : '补丁预览'} style={{ height: '100%' }}>
      {patchLoading ? (
        <Skeleton active />
      ) : patch ? (
        hunkMode ? (
          <Flex vertical gap={8}>
            <Flex align="center" gap={8} wrap="wrap">
              {previewStaged ? (
                <Button
                  size="small"
                  data-testid="hunk-unstage"
                  disabled={selected.length === 0}
                  loading={hunkActing}
                  onClick={() => fire('unstage')}
                >
                  取消暂存选中
                </Button>
              ) : (
                <>
                  <Button
                    size="small"
                    type="primary"
                    data-testid="hunk-stage"
                    disabled={selected.length === 0}
                    loading={hunkActing}
                    onClick={() => fire('stage')}
                  >
                    暂存选中
                  </Button>
                  <Popconfirm
                    title="放弃选中 hunk 的修改？不可恢复"
                    okText="确定"
                    cancelText="取消"
                    onConfirm={() => fire('discard')}
                  >
                    <Button size="small" danger data-testid="hunk-discard" disabled={selected.length === 0}>
                      放弃选中
                    </Button>
                  </Popconfirm>
                </>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已选 {selected.length} / {split!.hunks.length} 个 hunk
              </Typography.Text>
            </Flex>
            <Collapse
              size="small"
              items={split!.hunks.map((hunk) => ({
                key: hunk.index,
                label: (
                  <Flex align="center" gap={8}>
                    {/* 勾选点击不触发展开/收起：内层包 span 拦截冒泡，其余标签区点击仍可展开折叠 */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <Checkbox
                        data-testid={`hunk-check-${hunk.index}`}
                        checked={selected.includes(hunk.index)}
                        onChange={(e) => toggle(hunk.index, e.target.checked)}
                      />
                    </span>
                    <Typography.Text code style={{ fontSize: 12 }}>
                      hunk {hunk.index + 1}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                      {patchHunkHeading(hunk.header)}
                    </Typography.Text>
                  </Flex>
                ),
                children: (
                  <pre
                    data-testid={`hunk-text-${hunk.index}`}
                    style={{
                      margin: 0,
                      maxHeight: 240,
                      overflow: 'auto',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      whiteSpace: 'pre',
                    }}
                  >
                    {hunk.text}
                  </pre>
                ),
              }))}
            />
          </Flex>
        ) : (
          <pre
            data-testid="patch-text"
            style={{
              margin: 0,
              maxHeight: 480,
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'pre',
            }}
          >
            {patch.text}
          </pre>
        )
      ) : (
        <Typography.Text type="secondary">点击文件查看补丁预览</Typography.Text>
      )}
    </Card>
  );
}

export function StatusPage({
  status,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  committing,
  patch,
  patchLoading,
  previewStaged,
  onHunkStaging,
  hunkActing,
  onSelectPatch,
  onOpenDiff,
  changelists,
  onChangelistAction,
  onIgnore,
}: StatusPageProps): React.ReactNode {
  const grouped = useMemo(() => groupChanges(status.entries), [status.entries]);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);

  /** 变更列表模式仅在视图与回调同时具备时开启（向后兼容：缺省维持现状三分组） */
  const changelistMode = changelists !== undefined && onChangelistAction !== undefined;

  /** 「管理列表」菜单：新建 + 各列表一组（重命名/设默认/删除；默认列表设默认与删除禁用） */
  const manageItems: MenuProps['items'] = changelistMode
    ? [
      { key: 'create', label: '新建列表' },
      { type: 'divider' },
      ...changelists.lists.map((list) => ({
        type: 'group' as const,
        label: list.isDefault ? `${list.name}（默认）` : list.name,
        children: [
          { key: `rename:${list.id}`, label: '重命名' },
          { key: `setDefault:${list.id}`, label: '设为默认', disabled: list.isDefault },
          {
            key: `delete:${list.id}`,
            // 删除项包 span 携带 testid：断言默认列表删除禁用需定位到具体列表的菜单项
            label: <span data-testid={`cl-delete-${list.id}`}>删除</span>,
            danger: true,
            disabled: list.isDefault,
          },
        ],
      })),
    ]
    : [];

  /** 管理菜单分派：新建/重命名开对应 Modal；设默认/删除直发回调 */
  const handleManageClick: NonNullable<MenuProps['onClick']> = ({ key }): void => {
    if (!changelistMode) return;
    if (key === 'create') {
      setCreateOpen(true);
      return;
    }
    const [action, id] = key.split(':');
    if (action === 'rename') setRenameTarget(id);
    if (action === 'setDefault') onChangelistAction({ action: 'setDefault', id });
    if (action === 'delete') onChangelistAction({ action: 'delete', id });
  };

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      {/* 页头工具条：变更列表管理入口（仅 changelists 模式渲染） */}
      {changelistMode && (
        <Flex>
          <Dropdown trigger={['click']} menu={{ items: manageItems, onClick: handleManageClick }}>
            <Button data-testid="manage-changelists">管理列表</Button>
          </Dropdown>
        </Flex>
      )}
      {/* 左列三组变更列表 + 右列补丁预览（窄屏自然折行为上下布局） */}
      <Flex gap={16} align="stretch" wrap="wrap">
        <Flex vertical gap={16} style={{ flex: 1, minWidth: 320 }}>
          <ChangeGroup
            title="已暂存"
            group="staged"
            entries={grouped.staged}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
            changelists={changelistMode ? changelists : undefined}
            onChangelistAction={onChangelistAction}
            actions={(selected) => (
              <Button
                size="small"
                data-testid="unstage-staged"
                disabled={selected.length === 0}
                onClick={() => onUnstage(selected)}
              >
                取消暂存
              </Button>
            )}
          />
          <ChangeGroup
            title="工作区"
            group="unstaged"
            entries={grouped.unstaged}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
            changelists={changelistMode ? changelists : undefined}
            onChangelistAction={onChangelistAction}
            actions={(selected) => (
              <>
                <Button
                  size="small"
                  data-testid="stage-unstaged"
                  disabled={selected.length === 0}
                  onClick={() => onStage(selected)}
                >
                  暂存
                </Button>
                <Popconfirm
                  title="放弃选中修改？不可恢复"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => onDiscard(selected)}
                >
                  <Button size="small" danger data-testid="discard-unstaged" disabled={selected.length === 0}>
                    放弃
                  </Button>
                </Popconfirm>
              </>
            )}
          />
          <ChangeGroup
            title="未跟踪"
            group="untracked"
            entries={grouped.untracked}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
            changelists={changelistMode ? changelists : undefined}
            onChangelistAction={onChangelistAction}
            onIgnore={onIgnore}
            actions={(selected) => (
              <>
                <Button
                  size="small"
                  data-testid="stage-untracked"
                  disabled={selected.length === 0}
                  onClick={() => onStage(selected)}
                >
                  暂存
                </Button>
                {/* 未跟踪文件的"删除"即 discard 语义（服务端按条目状态分派 clean） */}
                <Popconfirm
                  title="删除选中未跟踪文件？不可恢复"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => onDiscard(selected)}
                >
                  <Button size="small" danger data-testid="discard-untracked" disabled={selected.length === 0}>
                    删除
                  </Button>
                </Popconfirm>
              </>
            )}
          />
        </Flex>
        <Flex vertical style={{ flex: 1, minWidth: 320 }}>
          <PatchCard
            patch={patch}
            patchLoading={patchLoading}
            previewStaged={previewStaged}
            onHunkStaging={onHunkStaging}
            hunkActing={hunkActing}
          />
        </Flex>
      </Flex>
      <CommitCard committing={committing} onCommit={onCommit} />

      {/* 列表名 Modal：新建/重命名互斥（renameTarget 非空才开重命名），提交后清空输入并关闭 */}
      <ChangelistNameModal
        title="新建列表"
        open={changelistMode && createOpen}
        inputTestId="cl-create-name"
        onSubmit={(name) => onChangelistAction?.({ action: 'create', name })}
        onClose={() => setCreateOpen(false)}
      />
      <ChangelistNameModal
        title="重命名列表"
        open={changelistMode && renameTarget !== null}
        inputTestId="cl-rename-input"
        onSubmit={(name) => {
          if (renameTarget !== null) onChangelistAction?.({ action: 'rename', id: renameTarget, name });
        }}
        onClose={() => setRenameTarget(null)}
      />
    </Flex>
  );
}
