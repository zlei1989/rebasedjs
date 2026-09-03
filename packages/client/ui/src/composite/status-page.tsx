/**
 * 状态页（Local Changes + 暂存区 + 提交框）：
 *  变更按 porcelain XY 码分三组——已暂存（X ∈ MADRC）、工作区（Y ∈ MDT）、未跟踪（??；!! 已忽略条目不展示）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入 hooks。
 */
import { useMemo, useState } from 'react';
import { Button, Card, Checkbox, Flex, Input, Popconfirm, Skeleton, Tag, Typography } from 'antd';
import type { ChangeEntry, CommitBody, DiffFile, RepoStatus } from '@rebased/contracts';

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
  onSelectPatch?: (path: string, staged: boolean) => void;
  /** 跳 diff 页（行双击或"查看对比"按钮） */
  onOpenDiff?: (path: string, staged: boolean) => void;
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

/** 三组内部标识：决定徽标取码（staged 取 X 列、unstaged 取 Y 列、untracked 无码）与 onSelectPatch 的 staged 参数 */
type ChangeGroupKind = 'staged' | 'unstaged' | 'untracked';

/** 行内 code 徽标：取该组语义对应的列字符（重命名 R、新增 A、修改 M、删除 D、类型变更 T、未跟踪 ?） */
function codeBadge(entry: ChangeEntry, group: ChangeGroupKind): string {
  if (group === 'staged') return entry.code[0] ?? '?';
  if (group === 'unstaged') return entry.code[1] ?? '?';
  return '?';
}

/** 变更组卡片：组头"全选"Checkbox + 组级操作按钮（Card extra）+ 行列表（Checkbox + 路径 + code 徽标） */
function ChangeGroup({
  title,
  group,
  entries,
  onSelectPatch,
  onOpenDiff,
  actions,
}: {
  title: string;
  group: ChangeGroupKind;
  entries: ChangeEntry[];
  onSelectPatch?: (path: string, staged: boolean) => void;
  onOpenDiff?: (path: string, staged: boolean) => void;
  /** 组级操作按钮渲染器：接收当前勾选路径，未勾选时按钮应禁用 */
  actions: (selected: string[]) => React.ReactNode;
}): React.ReactNode {
  const [selected, setSelected] = useState<string[]>([]);
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const allChecked = entries.length > 0 && selected.length === entries.length;

  /** 行勾选切换：维护本组勾选路径集合（行选中预览与勾选互不影响） */
  const toggle = (path: string, checked: boolean): void => {
    setSelected((prev) => (checked ? [...prev, path] : prev.filter((p) => p !== path)));
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
        ) : (
          entries.map((entry) => (
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
            </Flex>
          ))
        )}
      </Flex>
    </Card>
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

/** 补丁预览卡片：等宽渲染 patch.text；patchLoading 显 Skeleton；未选中文件时显占位提示 */
function PatchCard({ patch, patchLoading }: { patch?: DiffFile; patchLoading?: boolean }): React.ReactNode {
  return (
    <Card size="small" title={patch ? `补丁预览：${patch.path}` : '补丁预览'} style={{ height: '100%' }}>
      {patchLoading ? (
        <Skeleton active />
      ) : patch ? (
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
  onSelectPatch,
  onOpenDiff,
}: StatusPageProps): React.ReactNode {
  const grouped = useMemo(() => groupChanges(status.entries), [status.entries]);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      {/* 左列三组变更列表 + 右列补丁预览（窄屏自然折行为上下布局） */}
      <Flex gap={16} align="stretch" wrap="wrap">
        <Flex vertical gap={16} style={{ flex: 1, minWidth: 320 }}>
          <ChangeGroup
            title="已暂存"
            group="staged"
            entries={grouped.staged}
            onSelectPatch={onSelectPatch}
            onOpenDiff={onOpenDiff}
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
          <PatchCard patch={patch} patchLoading={patchLoading} />
        </Flex>
      </Flex>
      <CommitCard committing={committing} onCommit={onCommit} />
    </Flex>
  );
}
