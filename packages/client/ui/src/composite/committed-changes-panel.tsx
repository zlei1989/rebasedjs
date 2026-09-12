/**
 * Committed Changes 浏览器（对照平台 CommittedChangesBrowser 的平铺版）：
 *  提交列表左栏 + 选中提交的变更文件【目录树】右栏（目录节点可折叠、文件名叶子带状态徽标 A/M/D/R + renameFrom）。
 *  文件点击 → onOpenFile(path, hash)——from/to 差值端点映射由容器负责（约定 `${hash}~1` → hash）。
 *  「加载更多」为组件内简单交互：page 数据由容器注入，本组件只显示与回调（onLoadMore/loadingMore）。
 *  纯受控（page/selectedHash + 各回调）；ui 不调接口，数据与回调由调用方容器注入。
 *  列表/Listy 边界：左栏「提交列表」是同质条目列表 → 走 antd Listy（6.6.0 起，行不挂 Tooltip）；
 *  右栏「变更文件」是 buildFileTree 出来的递归目录树（目录可折叠、逐级 paddingLeft 缩进），树结构不属列表故不迁 Listy。
 */
import { useState } from 'react';
import { Button, Card, Flex, Listy, Tooltip, Typography, theme } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, FolderOutlined } from '@ant-design/icons';
import type { CommittedEntry, CommittedFileStatus, CommittedPage } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { EllipsisText } from '../base/ellipsis-text';
import { PageShell } from '../base/page-shell';
import { CommittedStatusTag } from '../domain/committed-status';
import { formatCommitDate } from '../domain/format';

export interface CommittedChangesPanelProps {
  page?: CommittedPage;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  selectedHash?: string;
  onSelectCommit?: (hash: string) => void;
  /** 文件点击载荷：路径 + 所属提交完整哈希（容器接 diff 端点；from/to 由容器解析 `${hash}~1`） */
  onOpenFile?: (path: string, hash: string) => void;
}

/** 目录树节点：dir=目录（可折叠，children 为子节点）；file=文件叶子（status/renameFrom 随文件）
 *  fileIndex 为文件在原 files 数组中的下标（叶子 testid 沿用 flat 时代语义） */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  status?: CommittedFileStatus;
  renameFrom?: string;
  fileIndex?: number;
  children?: FileTreeNode[];
}

/**
 * 平铺路径 → 目录树（纯函数，容器/测试复用）：按 '/' 分段建目录节点（叶子目录照建），文件挂到所属目录；
 * 同级排序：目录排文件前、各自按名称（平台文件树同语义）。
 */
export function buildFileTree(files: CommittedEntry['files']): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();
  files.forEach((file, index) => {
    const segments = file.path.split('/');
    const leafName = segments.pop() ?? file.path;
    let parent = roots;
    let acc = '';
    for (const seg of segments) {
      acc = acc === '' ? seg : `${acc}/${seg}`;
      let node = dirMap.get(acc);
      if (node === undefined) {
        node = { name: seg, path: acc, type: 'dir', children: [] };
        dirMap.set(acc, node);
        parent.push(node);
      }
      parent = node.children ?? [];
    }
    parent.push({
      name: leafName,
      path: file.path,
      type: 'file',
      ...(file.status !== undefined ? { status: file.status } : {}),
      ...(file.renameFrom !== undefined ? { renameFrom: file.renameFrom } : {}),
      fileIndex: index,
    });
  });
  const sortNodes = (nodes: FileTreeNode[]): void => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    nodes.forEach((n) => n.children !== undefined && sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

/** 提交行：短哈希 + subject（弹性）+ 作者 + 日期；整行点击 → onSelectCommit 完整哈希；命中 selectedHash 时底色高亮
 *  统一内边距交给 Listy 行容器（styles.item）；选中底色与光标是逐行差异故留在本行元素上 */
function CommitRow({
  entry,
  index,
  selected,
  onSelectCommit,
}: {
  entry: CommittedEntry;
  index: number;
  selected: boolean;
  onSelectCommit?: (hash: string) => void;
}): React.ReactNode {
  // 选中底色走主题 token（controlItemBgActive：明亮 #e6f4ff / 暗色 #111a2c），不再硬编码明亮专用色
  const { token } = theme.useToken();
  return (
    // 整行可点（未接 onSelectCommit 时是纯列表行）。
    // 行**不挂 Tooltip**（本次产品口径：行不挂气泡，行内按钮/图标的气泡保留）——原「整行包一层 Tooltip」已删。
    <Flex
      data-testid={`committed-entry-${index}`}
      align="center"
      gap={8}
      style={{
        // 行内边距留在可点元素自身（下沉到 Listy 的 styles.item 会让那圈内边距落在包装 div 上，不属命中区/选中底色区）
        padding: '4px 8px',
        cursor: onSelectCommit ? 'pointer' : undefined,
        backgroundColor: selected ? token.controlItemBgActive : undefined,
      }}
      onClick={() => onSelectCommit?.(entry.hash)}
    >
      {/* 短哈希改 EllipsisText：`mono` 与原 `code` 等价（同走 Typography.Text 的 code 呈现），
          `title` 给出完整哈希（antd 仅在文本溢出时才弹，短哈希一般不出浮层，故不新增可见行为）；
          `flexShrink: 0` 去掉——可收缩（超窄时截断而非撑宽行）。 */}
      <EllipsisText mono title={entry.hash}>
        {entry.shortHash}
      </EllipsisText>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {entry.subject}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {entry.author}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(entry.dateIso)}
      </Typography.Text>
    </Flex>
  );
}

/** 目录树节点渲染：目录行（叶子折叠图标 + 名称，点击折叠/展开）；文件叶子（状态徽标 + 原名→ + 名称，点击回调）
 *  文件 testid 沿用 committed-file-<原数组下标>（向后兼容既有断言）；目录 testid committed-dir-<路径> */
function TreeNodeRow({
  node,
  depth,
  hash,
  collapsed,
  onToggle,
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  hash: string;
  collapsed: Set<string>;
  /**
   * 目录行折叠开关。Tooltip 只包「行本身」而不是递归调用点：包在调用点上会罩住整棵子树，
   * 悬停子文件时目录气泡与文件气泡同弹（行气泡必须一对一）。
   */
  onToggle: (path: string) => void;
  onOpenFile?: (path: string, hash: string) => void;
}): React.ReactNode {
  if (node.type === 'dir') {
    const open = !collapsed.has(node.path);
    return (
      <>
        {/* 目录行整行可点（折叠/展开）→ 行 Tooltip 包在行本身，不包递归调用（否则会连带罩住子行） */}
        <Tooltip title={open ? '收起该目录（只影响显示，不改动任何文件）' : '展开该目录（只影响显示，不改动任何文件）'}>
          <Flex
            data-testid={`committed-dir-${node.path}`}
            align="center"
            gap={4}
            style={{ padding: '4px 0', paddingLeft: depth * 16, cursor: 'pointer' }}
            onClick={() => onToggle(node.path)}
          >
            {open ? <CaretDownOutlined style={{ fontSize: 10 }} /> : <CaretRightOutlined style={{ fontSize: 10 }} />}
            <FolderOutlined />
            {/* 目录名改 EllipsisText：目录名是不可断行串，长名会把本行（Flex，无 wrap）顶宽；
                EllipsisText 自带 minWidth:0 + ellipsis，截断取代撑宽；本处无 type/fontSize/strong 等
                语义样式，转换不丢任何呈现属性（仅 ellipsis 由内置承担）。 */}
            <EllipsisText title={node.name}>{node.name}</EllipsisText>
          </Flex>
        </Tooltip>
        {open
          ? (node.children ?? []).map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              hash={hash}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))
          : null}
      </>
    );
  }
  return (
    // 文件叶子整行可点（打开该文件的差异）→ 行 Tooltip（叶子无子行，不会与别的行气泡叠加）
    <Tooltip title={onOpenFile ? '打开该文件在本次提交里的差异对比' : undefined}>
      <Flex
        data-testid={`committed-file-${node.fileIndex ?? node.path}`}
        align="center"
        gap={8}
        style={{ padding: '4px 0', paddingLeft: depth * 16, cursor: onOpenFile ? 'pointer' : undefined }}
        onClick={() => onOpenFile?.(node.path, hash)}
      >
        {node.status !== undefined ? <CommittedStatusTag status={node.status} /> : null}
        {node.renameFrom ? (
          // 原路径是不可断行的长串（原 `flexShrink: 0` 的次要色文本，长路径会把本行顶宽）→ EllipsisText 截断；
          // 次要色由 `type="secondary"` 转发保留，`title` 给完整原路径（`→` 是固定后缀，不入 title）；
          // 路径非 hash/ref，故不加 `mono`；`fontSize: 12` 交紧凑密度（Ruling P4），`flexShrink: 0` 去掉。
          <EllipsisText type="secondary" title={node.renameFrom}>
            {`${node.renameFrom} →`}
          </EllipsisText>
        ) : null}
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {node.name}
        </Typography.Text>
      </Flex>
    </Tooltip>
  );
}

export function CommittedChangesPanel({
  page,
  onLoadMore,
  loadingMore,
  selectedHash,
  onSelectCommit,
  onOpenFile,
}: CommittedChangesPanelProps): React.ReactNode {
  const entries = page?.entries ?? [];
  // 右栏只展示当前选中提交的文件（selectedHash 由容器受控；未命中视为未选中）
  const selected = selectedHash ? entries.find((e) => e.hash === selectedHash) : undefined;
  // 目录树折叠态：Set<目录路径>（缺省全展开——平台文件树默认展开语义）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    /* 根是**纵向列容器**（页面级 composite 根），故按 Ruling P15(b) 迁 PageShell —— 它带来的
       width:100% / minWidth:0 正是本文件此前唯一缺失的那件「防顶宽」机制。
       传 density="default"：本组件被两端 app 页面容器嵌入（committed.tsx / committed/page.tsx 均为
       紧凑 PageShell），密度归宿主，这里只豁免、不重复施加（与 status-page / blame-view 同形）。
       gap/padding 照抄迁移前的值（8 / 16）；PageShell 默认不落 style，不传会静默丢掉内距。 */
    <PageShell density="default" gap={8} padding={16}>
      {entries.length === 0 ? (
        <EmptyState title="暂无提交记录" />
      ) : (
        /* 提交列表 + 变更文件两栏：本层是**横向** Flex（交叉轴为纵向），`align="flex-start"` 表示
           「子项顶部对齐」，与横向沾满无关 —— 按 Ruling P15 予以**保留**（删掉会把顶对齐变成等高拉伸，
           属未获授权的视觉变更）。注意：这条理由只属于**本层横向行**，不是「panel 根不迁 PageShell」
           的理由（早先版本的注释把两者混为一谈，已更正）。 */
        <Flex gap={16} align="flex-start">
          <Card size="small" title={`提交列表（${entries.length}）`} style={{ flex: 1, minWidth: 0 }}>
            <Flex vertical>
              {/* 提交列表走 antd Listy（6.6.0 起的列表组件，取代手写 map 行）：容器/行结构/悬停底色由组件负责；
                  行内边距沿用改造前的 4px 8px（Listy 默认 12px 16px）；行键与原 map 的 key 同（entry.hash）。 */}
              <Listy
                items={entries}
                rowKey={(entry) => entry.hash}
                itemRender={(entry, index) => (
                  <CommitRow
                    entry={entry}
                    index={index}
                    selected={entry.hash === selectedHash}
                    onSelectCommit={onSelectCommit}
                  />
                )}
                styles={{ item: { padding: 0 } }}
              />
              {/* 「加载更多」：仅在 hasMore 时出现；loading 态由 loadingMore 驱动（数据注入与回调由容器持有） */}
              {page?.hasMore ? (
                <Tooltip title="继续向后加载下一页提交记录（追加到现有列表）">
                  <Button
                    data-testid="committed-load-more"
                    loading={loadingMore}
                    onClick={onLoadMore}
                    style={{ marginTop: 8 }}
                  >
                    加载更多
                  </Button>
                </Tooltip>
              ) : null}
            </Flex>
          </Card>
          <Card
            size="small"
            title={selected ? `变更文件（${selected.files.length}）` : '变更文件'}
            style={{ flex: 2, minWidth: 0 }}
          >
            {!selected ? (
              <EmptyState title="选择一个提交查看变更文件" />
            ) : selected.files.length === 0 && selected.parents.length > 1 ? (
              /* 合并提交：git log --name-status 默认不输出 merge 的文件变更（合并结果按 diff-tree 展示），
                 空文件列表以 merge 提示替代误导性的「无文件变更」（终审 Minor） */
              <EmptyState title="合并提交" description="git 对合并提交默认不列出文件变更；请到日志页查看合并结果" />
            ) : selected.files.length === 0 ? (
              <EmptyState title="该提交无文件变更" />
            ) : (
              <Flex vertical>
                {/* 目录树：平铺路径经 buildFileTree 组织（目录可折叠；文件叶子保留原数组下标 testid）。
                    **有意不迁 Listy**：这是递归树（一层目录 → 子目录 → 文件叶子），行与行之间存在父子层级与
                    逐级缩进（paddingLeft: depth * 16），不是同质条目的一维列表；Listy 的行容器无法表达层级，
                    且树里同时渲染目录行与文件行两类语义不同的行（目录折叠 + 文件差异打开）。 */}
                {buildFileTree(selected.files).map((node) => (
                  <TreeNodeRow
                    key={node.path}
                    node={node}
                    depth={0}
                    hash={selected.hash}
                    collapsed={collapsed}
                    onToggle={toggleDir}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </Flex>
            )}
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}
