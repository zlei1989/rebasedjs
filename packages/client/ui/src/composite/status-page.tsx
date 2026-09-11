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
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Dropdown,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import { patchHunkHeading, splitPatchHunks } from '@rebased/contracts';
import type {
  AmendSpecificBody,
  AmendTarget,
  Changelist,
  ChangelistAction,
  ChangelistView,
  ChangeEntry,
  CommitBody,
  DiffFile,
  HunkStagingBody,
  PatchCreateBody,
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
  /** 行内「三版本」入口（已暂存/工作区组；HEAD/暂存/工作区三侧对比）：未传时不渲染该按钮 */
  onOpenThreeWay?: (path: string) => void;
  /** 组级「创建补丁」（Create Patch from changes 语义）：传入后已暂存/工作区组渲染按钮（勾选≥1 可用），
   *  Modal 收集 name，载荷含 paths + staged 模式（服务端契约 refine 保证 paths 与 from/to 互斥） */
  onCreatePatch?: (body: PatchCreateBody) => void;
  /** 组级「搁置」（Shelve Changes 语义）：传入后页头渲染「搁置」按钮（全量工作区+暂存，Modal 收集 name） */
  onShelve?: (name: string) => void;
  /** 组级「存入贮藏」（Stash Files 语义）：传入后页头渲染「存入贮藏」按钮（Modal 收集可选 message） */
  onStash?: (message: string | undefined) => void;
  /** 行内「注解」（Show in Annotate 语义）：传入后各组件行渲染按钮 → /blame?file= */
  onOpenAnnotate?: (path: string) => void;
  /** 行内「历史」（Show History 语义）：传入后各组件行渲染按钮 → /history?file= */
  onOpenHistory?: (path: string) => void;
  /** 组合执行器（GitCommitAndPushExecutor 语义）：提交后推送当前分支上游；缺省不渲染「提交并推送」按钮（向后兼容） */
  onCommitAndPush?: (body: CommitBody) => void;
  /** amend 目标候选（GitCommitDialog「Amend <subject>」语义）：提供时提交框渲染「amend 到…」下拉；null=未加载 */
  amendTargets?: AmendTarget[] | null;
  /** amend 指定历史提交：选中具体目标后提交走此回调（AmendSpecificBody：targetHash + 重写后的 message） */
  onAmendSpecific?: (body: AmendSpecificBody) => void;
  /** CRLF 提示涉事文件（GitCrlfDialog 语义；容器提交时先重验证再判定）：非空时提交框渲染警告内联提示 */
  crlfFiles?: string[];
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
  onOpenThreeWay,
  onOpenAnnotate,
  onOpenHistory,
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
  /** 行内「三版本」入口：已暂存/工作区组渲染（缺省不渲染） */
  onOpenThreeWay?: (path: string) => void;
  /** 行内「注解」入口：渲染（缺省不渲染） */
  onOpenAnnotate?: (path: string) => void;
  /** 行内「历史」入口：渲染（缺省不渲染） */
  onOpenHistory?: (path: string) => void;
}): React.ReactNode {
  const [selected, setSelected] = useState<string[]>([]);
  /** 悬停中的行路径：整行可点（选中预览/双击看差异）需行级气泡，但只在指针落在行本身时弹 */
  const [rowHover, setRowHover] = useState<string | null>(null);
  /** 悬停中的行内操作区所在行路径：行气泡与行内控件气泡互斥，否则两个气泡会同时弹出（参考 repo-page 的 hoverId/actionHoverId） */
  const [actionHover, setActionHover] = useState<string | null>(null);
  /**
   * 「移动到列表」菜单展开中的行路径：展开期间抑制该行按钮的气泡。
   * 原因同「管理列表」：气泡与菜单同侧时会压住菜单顶部若干项，菜单项既点不到也出不了自己的气泡。
   */
  const [moveMenuPath, setMoveMenuPath] = useState<string | null>(null);
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const allChecked = entries.length > 0 && selected.length === entries.length;

  /** 行内操作区（勾选/行按钮）的悬停追踪属性：只做悬停反馈（不拦点击），用于抑制行气泡 */
  const actionHoverProps = (path: string): { onMouseEnter: () => void; onMouseLeave: () => void } => ({
    onMouseEnter: () => setActionHover(path),
    onMouseLeave: () => setActionHover(null),
  });

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

    /** 行是否真有可点行为：两个回调都没接时不给行气泡（提示一个点了没反应的区域没有意义） */
    const clickable = onSelectPatch !== undefined || onOpenDiff !== undefined;

    return (
      // 整行可点（单击选中预览 / 双击看差异）且行内还有勾选与多个操作按钮：
      // 行 Tooltip 用受控 open——只在指针落在行本身、且不在行内操作区上时弹，
      // 否则行气泡会与勾选/按钮气泡同时弹出互相遮挡（参考 repo-page.tsx 的 hoverId / actionHoverId 写法）。
      // key 必须挂在这一层：Tooltip 成为 map 生成的最外层元素
      <Tooltip
        key={entry.path}
        open={clickable && rowHover === entry.path && actionHover !== entry.path}
        title={clickable ? '单击在右侧预览该文件的补丁，双击打开版本差异对比' : undefined}
      >
        <Flex
          data-testid={`row-${group}-${entry.path}`}
          align="center"
          gap={8}
          style={{ cursor: 'pointer', padding: '4px 0' }}
          // 纯悬停反馈（不改变点击/双击行为）：驱动上面受控的行气泡
          onMouseEnter={() => setRowHover(entry.path)}
          onMouseLeave={() => setRowHover(null)}
          onClick={() => onSelectPatch?.(entry.path, group === 'staged')}
          onDoubleClick={() => onOpenDiff?.(entry.path, group === 'staged')}
        >
          {/* 勾选不应触发行选中预览：阻止点击冒泡到行；同时悬停时抑制行气泡（勾选自带气泡） */}
          <Flex onClick={(e) => e.stopPropagation()} {...actionHoverProps(entry.path)}>
            <Tooltip title="勾选该文件加入本组批量操作集合（与右侧预览选中互不影响）">
              <Checkbox
                data-testid={`check-${group}-${entry.path}`}
                checked={selected.includes(entry.path)}
                onChange={(e) => toggle(entry.path, e.target.checked)}
              />
            </Tooltip>
          </Flex>
          <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
            {entry.path}
          </Typography.Text>
          <Tag>{codeBadge(entry, group)}</Tag>
          {/* 「移动到列表」行操作：仅 changelists 模式渲染；无可用目标（仅默认列表且在默认列表）时禁用 */}
          {changelists !== undefined && onChangelistAction !== undefined && (
            <Flex onClick={(e) => e.stopPropagation()} {...actionHoverProps(entry.path)}>
              <Dropdown
                trigger={['click']}
                disabled={moveTargets.length === 0}
                onOpenChange={(open) => setMoveMenuPath(open ? entry.path : null)}
                menu={{
                  items: moveTargets.map((l) => ({ key: l.id, label: l.name })),
                  onClick: ({ key }) => move(key),
                }}
              >
                {/* Tooltip 放 Dropdown 内层（Dropdown > Tooltip > Button）：不打断 Dropdown 的触发链；
                    菜单展开时抑制气泡，避免翻到下方压住菜单项 */}
                <Tooltip
                  title="把该文件指派到其它变更列表（该行已勾选时，连同其它勾选项一起移动）"
                  open={moveMenuPath === entry.path ? false : undefined}
                >
                  <Button size="small" type="text" data-testid={`move-${group}-${entry.path}`}>
                    移动到列表
                  </Button>
                </Tooltip>
              </Dropdown>
            </Flex>
          )}
          {/* 「忽略」行操作：仅未跟踪组渲染（缺省不渲染，向后兼容）；点击不触发行选中 */}
          {group === 'untracked' && onIgnore !== undefined && (
            <Flex onClick={(e) => e.stopPropagation()} {...actionHoverProps(entry.path)}>
              <Tooltip title="把该文件写入 .gitignore，之后不再作为未跟踪变更出现">
                <Button size="small" type="text" data-testid={`ignore-${group}-${entry.path}`} onClick={() => onIgnore(entry.path)}>
                  忽略
                </Button>
              </Tooltip>
            </Flex>
          )}
          {/* 「三版本」行操作：已暂存/工作区组渲染（未跟踪无版本三侧可对比）；点击不触发行选中 */}
          {group !== 'untracked' && onOpenThreeWay !== undefined && (
            <Flex onClick={(e) => e.stopPropagation()} {...actionHoverProps(entry.path)}>
              <Tooltip title="并排对比该文件的 HEAD / 暂存区 / 工作区三个版本">
                <Button
                  size="small"
                  type="text"
                  data-testid={`three-way-${group}-${entry.path}`}
                  onClick={() => onOpenThreeWay(entry.path)}
                >
                  三版本
                </Button>
              </Tooltip>
            </Flex>
          )}
          {/* 「注解」行操作（Annotate 语义）；点击不触发行选中 */}
          {onOpenAnnotate !== undefined && (
            <Flex onClick={(e) => e.stopPropagation()} {...actionHoverProps(entry.path)}>
              <Tooltip title="打开该文件的逐行溯源页（blame），查看每行的最后修改提交">
                <Button
                  size="small"
                  type="text"
                  data-testid={`annotate-${group}-${entry.path}`}
                  onClick={() => onOpenAnnotate(entry.path)}
                >
                  注解
                </Button>
              </Tooltip>
            </Flex>
          )}
          {/* 「历史」行操作（Show History 语义）；点击不触发行选中 */}
          {onOpenHistory !== undefined && (
            <Flex onClick={(e) => e.stopPropagation()} {...actionHoverProps(entry.path)}>
              <Tooltip title="打开该文件的提交历史页，查看它的历次变更记录">
                <Button
                  size="small"
                  type="text"
                  data-testid={`history-${group}-${entry.path}`}
                  onClick={() => onOpenHistory(entry.path)}
                >
                  历史
                </Button>
              </Tooltip>
            </Flex>
          )}
        </Flex>
      </Tooltip>
    );
  };

  return (
    <Card
      size="small"
      title={`${title}（${entries.length}）`}
      extra={
        <Flex align="center" gap={8}>
          <Tooltip title="勾选本组全部文件（取消勾选即清空本组选择）">
            <Checkbox
              data-testid={`select-all-${group}`}
              checked={allChecked}
              indeterminate={selected.length > 0 && !allChecked}
              onChange={(e) => setSelected(e.target.checked ? paths : [])}
            >
              全选
            </Checkbox>
          </Tooltip>
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
      <Tooltip title="变更列表名称：非空才能提交，确定后由容器新建或重命名列表">
        <Input
          data-testid={inputTestId}
          placeholder="列表名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Tooltip>
    </Modal>
  );
}

/** 状态页动作输入 Modal 状：创建补丁 / 搁置 / 存入贮藏 共用（title/占位/必填性可配） */
type PageActionModalKind = 'patch' | 'shelf' | 'stash';

/**
 * 三动作 Modal（单选互斥——StatusPage 同刻只开一个）：
 * - patch：name 必填（占位「补丁名（必填）」），提交以 { name, paths, staged? } 调 onCreatePatch；
 * - shelf：name 必填（占位「搁置名（必填）」），提交以 { name } 调 onShelve；
 * - stash：message 可空（占位「贮藏信息（可空）」），提交以 { message | undefined } 调 onStash。
 */
function PageActionModal({
  kind,
  patchStaged,
  patchPaths,
  onCreatePatch,
  onShelve,
  onStash,
  onClose,
}: {
  kind: PageActionModalKind;
  patchStaged: boolean;
  patchPaths: string[];
  onCreatePatch?: (body: PatchCreateBody) => void;
  onShelve?: (name: string) => void;
  onStash?: (message: string | undefined) => void;
  onClose: () => void;
}): React.ReactNode {
  const [text, setText] = useState('');

  /** 关闭时清空输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setText('');
    onClose();
  };

  const patch = kind === 'patch';
  const shelf = kind === 'shelf';
  const required = patch || shelf;

  const submit = (): void => {
    const trimmed = text.trim();
    if (patch) {
      onCreatePatch?.({ name: trimmed, paths: patchPaths, ...(patchStaged ? { staged: true } : {}) });
    } else if (shelf) {
      onShelve?.(trimmed);
    } else {
      onStash?.(trimmed === '' ? undefined : trimmed);
    }
    close();
  };

  return (
    <Modal
      title={patch ? '创建补丁' : shelf ? '搁置变更' : '存入贮藏'}
      open
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: required && text.trim() === '' }}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={8}>
        {/* 三种动作共用同一输入框：气泡文案按 kind 分流，说明「填什么、必填与否」 */}
        <Tooltip
          title={
            patch
              ? '补丁名（必填）：确定后以此名对勾选的文件生成补丁'
              : shelf
                ? '搁置名（必填）：用于在搁置列表中标识这次保存的变更'
                : '贮藏说明（可空）：留空则由 git 依当前分支生成说明'
          }
        >
          <Input
            data-testid={`page-action-${patch ? 'patch' : shelf ? 'shelf' : 'stash'}-input`}
            placeholder={patch ? '补丁名（必填）' : shelf ? '搁置名（必填）' : '贮藏信息（可空）'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Tooltip>
        {patch ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            对勾选的 {patchPaths.length} 个文件创建补丁（{patchStaged ? '暂存区 diff' : '工作区 diff'}）
          </Typography.Text>
        ) : null}
      </Flex>
    </Modal>
  );
}

/** 提交框卡片：TextArea（自适应行数）+ amend/signOff/noVerify + 「amend 到…」下拉（指定历史提交）+ primary 提交按钮 + 提交并推送（组合执行器 #50） */
function CommitCard({
  committing,
  onCommit,
  onCommitAndPush,
  amendTargets,
  onAmendSpecific,
  crlfFiles,
}: {
  committing?: boolean;
  onCommit: (body: CommitBody) => void;
  /** 组合执行器（GitCommitAndPushExecutor 语义）：提交后推送到当前分支上游；缺省不渲染按钮（向后兼容） */
  onCommitAndPush?: (body: CommitBody) => void;
  /** amend 目标候选（Amend <subject> 下拉语义）；null/undefined = 未加载 */
  amendTargets?: AmendTarget[] | null;
  /** amend 指定历史提交（选中具体目标后提交走此回调）；缺省不渲染下拉 */
  onAmendSpecific?: (body: AmendSpecificBody) => void;
  /** CRLF 提示涉事文件（非空渲染警告内联提示——GitCrlfDialog 的 Web 形态） */
  crlfFiles?: string[];
}): React.ReactNode {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  // 「amend 到…」：选中具体目标提交（非空 = 指定历史提交模式）
  const [amendTargetHash, setAmendTargetHash] = useState('');

  /** 组装提交体：仅在为 true 时带可选标志（契约 CommitBody 均为 optional，避免传冗余 false）；指定目标时走 amend-specific */
  const submit = (): void => {
    if (amendTargetHash !== '') {
      onAmendSpecific?.({ targetHash: amendTargetHash, message: message.trim() });
      return;
    }
    const body: CommitBody = { message: message.trim() };
    if (amend) body.amend = true;
    if (signOff) body.signOff = true;
    if (noVerify) body.noVerify = true;
    onCommit(body);
  };

  /** 提交并推送：组装体同提交（组合执行器在容器内追加 push 载荷并分派结果提示；指定目标不支持组合——仅提交） */
  const submitAndPush = (): void => {
    if (amendTargetHash !== '') {
      onAmendSpecific?.({ targetHash: amendTargetHash, message: message.trim() });
      return;
    }
    const body: CommitBody = { message: message.trim() };
    if (amend) body.amend = true;
    if (signOff) body.signOff = true;
    if (noVerify) body.noVerify = true;
    onCommitAndPush?.(body);
  };

  return (
    <Card size="small" title="提交">
      <Flex vertical gap={8}>
        {crlfFiles !== undefined && crlfFiles.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            data-testid="crlf-warning"
            title={`即将提交的文件含 CRLF 行尾符（${crlfFiles.slice(0, 3).join('、')}${crlfFiles.length > 3 ? ` 等 ${crlfFiles.length} 个` : ''}）；core.autocrlf 未按建议设置，建议修复后提交`}
          />
        ) : null}
        <Tooltip title="提交信息：首行作为标题；amend 模式不会沿用原提交信息，必须重新填写">
          <Input.TextArea
            data-testid="commit-message"
            autoSize={{ minRows: 2, maxRows: 6 }}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            // amend 必须给新 message（服务端 git commit --amend -m），留空不沿用原 message
            placeholder={amendTargetHash !== '' ? '修改目标提交的提交信息' : amend ? '修改上一次提交的提交信息' : '提交信息'}
          />
        </Tooltip>
        <Flex align="center" gap={16} wrap="wrap">
          {/* 已选定 amend 目标（amend 到…）时本开关禁用：两种 amend 模式互斥。
              antd 禁用控件不派发 hover 事件，故 Tooltip 与控件之间包一层 span 承接提示 */}
          <Tooltip
            title={
              amendTargetHash !== ''
                ? '已选定要改写的历史提交：本次提交固定走「amend 到指定提交」，不能再改为修改上一次提交'
                : '改写上一次提交而不是新建提交（提交信息需重新填写，不会沿用原信息）'
            }
          >
            <span>
              <Checkbox
                checked={amend}
                disabled={amendTargetHash !== ''}
                onChange={(e) => setAmend(e.target.checked)}
              >
                amend
              </Checkbox>
            </span>
          </Tooltip>
          {onAmendSpecific !== undefined ? (
            <Tooltip title="按提交标题选择要改写的历史提交：选中后本次提交 amend 到该提交，并自动取消上面的 amend 开关">
              <Select
                data-testid="amend-target-select"
                style={{ minWidth: 220 }}
                placeholder="amend 到…（指定历史提交）"
                allowClear
                loading={amendTargets === undefined || amendTargets === null}
                options={(amendTargets ?? []).map((t) => ({ value: t.hash, label: `Amend ${t.subject}` }))}
                value={amendTargetHash === '' ? undefined : amendTargetHash}
                onChange={(v) => {
                  setAmendTargetHash(v ?? '');
                  if (v !== undefined) setAmend(false);
                }}
              />
            </Tooltip>
          ) : null}
          <Tooltip title="在提交信息末尾追加 Signed-off-by 行（DCO 开发者原创声明）">
            <Checkbox checked={signOff} onChange={(e) => setSignOff(e.target.checked)}>
              signOff
            </Checkbox>
          </Tooltip>
          <Tooltip title="跳过 pre-commit / commit-msg 等提交钩子校验（本地检查不再拦截本次提交）">
            <Checkbox checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)}>
              noVerify
            </Checkbox>
          </Tooltip>
          <Flex gap={8}>
            {/* 提交信息为空时禁用：包 span 让禁用态也能弹提示，说明为什么点不动 */}
            <Tooltip
              title={
                message.trim() === ''
                  ? '提交信息为空：填写提交信息后即可提交'
                  : amendTargetHash !== ''
                    ? '把暂存的改动 amend 到选中的历史提交'
                    : '把暂存区内容提交到当前分支'
              }
            >
              <span>
                <Button
                  type="primary"
                  data-testid="commit-button"
                  loading={committing}
                  disabled={message.trim() === ''}
                  onClick={submit}
                >
                  提交
                </Button>
              </span>
            </Tooltip>
            {onCommitAndPush !== undefined && (
              // 信息为空或已指定 amend 目标时禁用（组合执行器不支持 amend-specific），禁用态同样需要 span 承接提示
              <Tooltip
                title={
                  message.trim() === ''
                    ? '提交信息为空：填写提交信息后即可提交并推送'
                    : amendTargetHash !== ''
                      ? '已选定 amend 目标提交：组合推送不可用，请改用「提交」'
                      : '提交后把当前分支推送到它的上游分支'
                }
              >
                <span>
                  <Button
                    data-testid="commit-and-push-button"
                    loading={committing}
                    disabled={message.trim() === '' || amendTargetHash !== ''}
                    onClick={submitAndPush}
                  >
                    提交并推送
                  </Button>
                </span>
              </Tooltip>
            )}
          </Flex>
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
                // 未勾选任何 hunk 时禁用；禁用按钮不派发 hover，包 span 承接「为什么禁用」的提示
                <Tooltip title={selected.length === 0 ? '先勾选要取消暂存的 hunk' : '把选中的 hunk 从暂存区移回工作区'}>
                  <span>
                    <Button
                      size="small"
                      data-testid="hunk-unstage"
                      disabled={selected.length === 0}
                      loading={hunkActing}
                      onClick={() => fire('unstage')}
                    >
                      取消暂存选中
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <>
                  <Tooltip title={selected.length === 0 ? '先勾选要暂存的 hunk' : '把选中的 hunk 从工作区加入暂存区'}>
                    <span>
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
                    </span>
                  </Tooltip>
                  <Popconfirm
                    title="放弃选中 hunk 的修改？不可恢复"
                    okText="确定"
                    cancelText="取消"
                    onConfirm={() => fire('discard')}
                  >
                    {/* Tooltip 放 Popconfirm 内层（Popconfirm > Tooltip > span > Button）：不打断确认气泡的触发链；
                        span 用于让禁用态也能弹提示 */}
                    <Tooltip title={selected.length === 0 ? '先勾选要放弃的 hunk' : '丢弃选中 hunk 的工作区改动（确认后不可恢复）'}>
                      <span>
                        <Button size="small" danger data-testid="hunk-discard" disabled={selected.length === 0}>
                          放弃选中
                        </Button>
                      </span>
                    </Tooltip>
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
                      <Tooltip title="勾选该 hunk 加入上面按钮的批量操作集合（部分暂存）">
                        <Checkbox
                          data-testid={`hunk-check-${hunk.index}`}
                          checked={selected.includes(hunk.index)}
                          onChange={(e) => toggle(hunk.index, e.target.checked)}
                        />
                      </Tooltip>
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
  onOpenThreeWay,
  onCreatePatch,
  onShelve,
  onStash,
  onOpenAnnotate,
  onOpenHistory,
  onCommitAndPush,
  amendTargets,
  onAmendSpecific,
  crlfFiles,
}: StatusPageProps): React.ReactNode {
  const grouped = useMemo(() => groupChanges(status.entries), [status.entries]);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  /** 页头动作 Modal 状态（创建补丁/搁置/存入贮藏三选一，同刻只开一个） */
  const [pageAction, setPageAction] = useState<
    { kind: 'patch'; paths: string[]; staged: boolean } | { kind: 'shelf' } | { kind: 'stash' } | null
  >(null);

  /** 变更列表模式仅在视图与回调同时具备时开启（向后兼容：缺省维持现状三分组） */
  const changelistMode = changelists !== undefined && onChangelistAction !== undefined;
  /**
   * 「管理列表」菜单是否展开：展开期间抑制触发按钮的气泡。
   * 原因（浏览器实测）：按钮在页头工具条，气泡会被 antd 翻到下方压住菜单顶部若干项，
   * 命中气泡容器的指针既点不到菜单项也出不了菜单项自己的气泡。
   */
  const [manageMenuOpen, setManageMenuOpen] = useState(false);

  /** 「管理列表」菜单：新建 + 各列表一组（重命名/设默认/删除；默认列表设默认与删除禁用） */
  const manageItems: MenuProps['items'] = changelistMode
    ? [
      // 菜单项 label 用 Tooltip > span 包裹：菜单项是数据对象而非 JSX，span 让 antd 菜单项样式照旧生效
      { key: 'create', label: <Tooltip title="新建变更列表：随后弹出对话框填写名称，列表用于给改动分组"><span>新建列表</span></Tooltip> },
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
      {/* 页头工具条：变更列表管理入口（仅 changelists 模式渲染）+ 页级动作（搁置/存入贮藏——全量工作区+暂存，不依赖勾选） */}
      <Flex gap={8} align="center">
        {changelistMode && (
          <Dropdown
            trigger={['click']}
            onOpenChange={setManageMenuOpen}
            menu={{ items: manageItems, onClick: handleManageClick }}
          >
            {/* Tooltip 放 Dropdown 内层：不打断管理菜单的触发链；菜单展开时抑制气泡，避免压住菜单项 */}
            <Tooltip
              title="新建、重命名、设为默认或删除变更列表（默认列表不可删除/设默认）"
              open={manageMenuOpen ? false : undefined}
            >
              <Button data-testid="manage-changelists">管理列表</Button>
            </Tooltip>
          </Dropdown>
        )}
        {onShelve !== undefined && (
          <Tooltip title="把工作区与暂存区的全部改动保存为具名搁置，之后可从搁置列表恢复">
            <Button data-testid="action-shelve" onClick={() => setPageAction({ kind: 'shelf' })}>
              搁置
            </Button>
          </Tooltip>
        )}
        {onStash !== undefined && (
          <Tooltip title="把当前全部改动存入 git 贮藏（stash），工作区随之回到干净状态">
            <Button data-testid="action-stash" onClick={() => setPageAction({ kind: 'stash' })}>
              存入贮藏
            </Button>
          </Tooltip>
        )}
      </Flex>
      {/* 左列三组变更列表 + 右列补丁预览（窄屏自然折行为上下布局） */}
      <Flex gap={16} align="stretch" wrap="wrap">
        <Flex vertical gap={16} style={{ flex: 1, minWidth: 320 }}>
          <ChangeGroup
            title="已暂存"
            group="staged"
            entries={grouped.staged}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
            onOpenThreeWay={onOpenThreeWay}
            onOpenAnnotate={onOpenAnnotate}
            onOpenHistory={onOpenHistory}
            changelists={changelistMode ? changelists : undefined}
            onChangelistAction={onChangelistAction}
            actions={(selected) => (
              <>
                {/* 组级按钮都在未勾选时禁用：包 span 让禁用态也能弹「先勾选文件」的原因说明 */}
                <Tooltip title={selected.length === 0 ? '先勾选要取消暂存的文件' : '把勾选的文件从暂存区移回工作区'}>
                  <span>
                    <Button
                      size="small"
                      data-testid="unstage-staged"
                      disabled={selected.length === 0}
                      onClick={() => onUnstage(selected)}
                    >
                      取消暂存
                    </Button>
                  </span>
                </Tooltip>
                {onCreatePatch !== undefined && (
                  <Tooltip title={selected.length === 0 ? '先勾选要打包的文件' : '按暂存区 diff 为勾选文件生成补丁（弹窗填补丁名）'}>
                    <span>
                      <Button
                        size="small"
                        data-testid="create-patch-staged"
                        disabled={selected.length === 0}
                        onClick={() => setPageAction({ kind: 'patch', paths: selected, staged: true })}
                      >
                        创建补丁
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </>
            )}
          />
          <ChangeGroup
            title="工作区"
            group="unstaged"
            entries={grouped.unstaged}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
            onOpenThreeWay={onOpenThreeWay}
            onOpenAnnotate={onOpenAnnotate}
            onOpenHistory={onOpenHistory}
            changelists={changelistMode ? changelists : undefined}
            onChangelistAction={onChangelistAction}
            actions={(selected) => (
              <>
                <Tooltip title={selected.length === 0 ? '先勾选要暂存的文件' : '把勾选文件的工作区改动加入暂存区'}>
                  <span>
                    <Button
                      size="small"
                      data-testid="stage-unstaged"
                      disabled={selected.length === 0}
                      onClick={() => onStage(selected)}
                    >
                      暂存
                    </Button>
                  </span>
                </Tooltip>
                <Popconfirm
                  title="放弃选中修改？不可恢复"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => onDiscard(selected)}
                >
                  {/* Tooltip 在 Popconfirm 内层，span 承接禁用态提示（两处都不打断确认气泡的触发链） */}
                  <Tooltip title={selected.length === 0 ? '先勾选要放弃修改的文件' : '丢弃勾选文件的工作区改动（确认后不可恢复）'}>
                    <span>
                      <Button size="small" danger data-testid="discard-unstaged" disabled={selected.length === 0}>
                        放弃
                      </Button>
                    </span>
                  </Tooltip>
                </Popconfirm>
                {onCreatePatch !== undefined && (
                  <Tooltip title={selected.length === 0 ? '先勾选要打包的文件' : '按工作区 diff 为勾选文件生成补丁（弹窗填补丁名）'}>
                    <span>
                      <Button
                        size="small"
                        data-testid="create-patch-unstaged"
                        disabled={selected.length === 0}
                        onClick={() => setPageAction({ kind: 'patch', paths: selected, staged: false })}
                      >
                        创建补丁
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </>
            )}
          />
          <ChangeGroup
            title="未跟踪"
            group="untracked"
            entries={grouped.untracked}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
            onOpenAnnotate={onOpenAnnotate}
            onOpenHistory={onOpenHistory}
            changelists={changelistMode ? changelists : undefined}
            onChangelistAction={onChangelistAction}
            onIgnore={onIgnore}
            actions={(selected) => (
              <>
                <Tooltip title={selected.length === 0 ? '先勾选要暂存的文件' : '把勾选的未跟踪文件加入暂存区（此后 git 开始跟踪它们）'}>
                  <span>
                    <Button
                      size="small"
                      data-testid="stage-untracked"
                      disabled={selected.length === 0}
                      onClick={() => onStage(selected)}
                    >
                      暂存
                    </Button>
                  </span>
                </Tooltip>
                {/* 未跟踪文件的"删除"即 discard 语义（服务端按条目状态分派 clean） */}
                <Popconfirm
                  title="删除选中未跟踪文件？不可恢复"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => onDiscard(selected)}
                >
                  {/* Tooltip 在 Popconfirm 内层，span 承接禁用态提示 */}
                  <Tooltip title={selected.length === 0 ? '先勾选要删除的文件' : '删除勾选的未跟踪文件（按未跟踪状态走 clean，确认后不可恢复）'}>
                    <span>
                      <Button size="small" danger data-testid="discard-untracked" disabled={selected.length === 0}>
                        删除
                      </Button>
                    </span>
                  </Tooltip>
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
      <CommitCard
        committing={committing}
        onCommit={onCommit}
        onCommitAndPush={onCommitAndPush}
        amendTargets={amendTargets}
        onAmendSpecific={onAmendSpecific}
        crlfFiles={crlfFiles}
      />

      {/* 页头/组级动作 Modal：创建补丁（组级勾选路径）/ 搁置 / 存入贮藏（三选一，同刻只开一个） */}
      {pageAction !== null && (
        <PageActionModal
          kind={pageAction.kind}
          patchStaged={pageAction.kind === 'patch' ? pageAction.staged : false}
          patchPaths={pageAction.kind === 'patch' ? pageAction.paths : []}
          onCreatePatch={onCreatePatch}
          onShelve={onShelve}
          onStash={onStash}
          onClose={() => setPageAction(null)}
        />
      )}

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
