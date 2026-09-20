/**
 * 溯源页三栏工作台：文件（HEAD 目录树） | 提交记录（该文件的提交清单） | 变更内容（操作条 + 三标签）。
 * 为什么这么分（用户口径，见 design §0.2）：左栏解决「换文件要手打路径」，中栏解决「这文件改过几次」，
 * 右栏解决「这次提交到底改了什么」——三个问题各占一栏，一屏内闭环；逐行注解归到右栏第三个标签，
 * 于是「逐行归属 → 提交 → 变更」的主链路不再需要跳页或新开标签。
 * 三栏宽度走 base/resizable-columns（antd Splitter 映射）：左/中非弹性（像素偏好记 localStorage），
 * 右栏弹性吃剩余——差异最需要宽度。纯受控：ui 不调接口，数据与动作由容器注入。
 */
import { Flex } from 'antd';
import type { BlameLine, BrowseEntry, CommittedEntry, FileHistoryEntry, FileVersions } from '@rebased/contracts';
import { useState } from 'react';
import { EmptyState } from '../base/empty-state';
import { ResizableColumns, restoreWidthsToAvailable, type ResizablePane } from '../base/resizable-columns';
import { useStoredWidth } from '../base/stored-preference';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';
import { BlameChangePane } from './blame-change-pane';
import { BlameCommitsColumn } from './blame-commits-column';
import type { BlameViewKey } from './blame-state';
import { SnapshotTreeColumn } from './snapshot-tree-column';

/** 左栏（文件树）默认/夹紧宽度：240 约放得下两层路径，80 是「还能拖到多窄」的硬下限 */
const TREE_WIDTH = { default: 240, min: 80, max: 480 };
/** 中栏（提交清单）默认/夹紧宽度：320 够放「短哈希 + 一行标题」，640 以上只是留白 */
const COMMITS_WIDTH = { default: 320, min: 80, max: 640 };
/** 右栏（变更内容）下限：差异与注解都需要宽度，240 是「还能看」的底线 */
const PANE_MIN_PX = 240;
/** 列宽偏好键（与日志页 `rebased.log.*` 同一命名口径） */
const TREE_WIDTH_KEY = 'rebased.blame.treeWidth';
const COMMITS_WIDTH_KEY = 'rebased.blame.commitsWidth';

export interface BlameWorkbenchProps {
  /** 当前溯源的相对路径（'' = 还没选文件） */
  file: string;
  tree: { entries?: BrowseEntry[]; loading?: boolean; error?: string };
  commits: { entries?: FileHistoryEntry[]; loading?: boolean; error?: string };
  /** 选中的提交哈希（'' = 没有可看的提交） */
  hash: string;
  view: BlameViewKey;
  entry?: CommittedEntry | null;
  changes: { versions?: FileVersions; loading?: boolean; error?: string };
  latest: { versions?: FileVersions; loading?: boolean; error?: string };
  annotate: { lines?: BlameLine[]; loading?: boolean; error?: string };
  affected: { hash: string; entry?: CommittedEntry | null; loading?: boolean; error?: string | null };
  onSelectFile?: (path: string) => void;
  onSelectCommit?: (hash: string) => void;
  onViewChange?: (view: BlameViewKey) => void;
  onOpenCommit?: (hash: string) => void;
  onOpenDiff?: (hash: string) => void;
  onShowAffected?: (hash: string) => void;
  onOpenInHistory?: (hash: string) => void;
  onCloseAffected?: () => void;
  onOpenAffectedFile?: (path: string) => void;
  /** 测试注入点：替换 monaco 加载器 */
  loader?: MonacoDiffLoader;
}

export function BlameWorkbench({
  file,
  tree,
  commits,
  hash,
  view,
  entry,
  changes,
  latest,
  annotate,
  affected,
  onSelectFile,
  onSelectCommit,
  onViewChange,
  onOpenCommit,
  onOpenDiff,
  onShowAffected,
  onOpenInHistory,
  onCloseAffected,
  onOpenAffectedFile,
  loader,
}: BlameWorkbenchProps): React.ReactNode {
  const [treeWidth, setTreeWidth] = useStoredWidth(TREE_WIDTH_KEY, TREE_WIDTH.default, TREE_WIDTH.min, TREE_WIDTH.max);
  const [commitsWidth, setCommitsWidth] = useStoredWidth(
    COMMITS_WIDTH_KEY,
    COMMITS_WIDTH.default,
    COMMITS_WIDTH.min,
    COMMITS_WIDTH.max,
  );
  /** 容器实测宽度：非弹性列据此按比例收缩（见 base/resizable-columns 的尺寸口径） */
  const [available, setAvailable] = useState(0);
  const widthPanes: Pick<ResizablePane, 'key' | 'width' | 'min' | 'max' | 'flexible'>[] = [
    { key: 'tree', width: treeWidth, min: TREE_WIDTH.min, max: TREE_WIDTH.max },
    { key: 'commits', width: commitsWidth, min: COMMITS_WIDTH.min, max: COMMITS_WIDTH.max },
    { key: 'pane', width: 0, min: PANE_MIN_PX, max: Number.MAX_SAFE_INTEGER, flexible: true },
  ];
  const paneWidths = restoreWidthsToAvailable(
    widthPanes.map((p) => p.width),
    widthPanes,
    available,
    widthPanes.length - 1,
  );
  /**
   * 拖动回写：本页栏数恒为 3（不会增删），故按下标取用是安全的（日志页栏数会随开关增删，那边按 key 定位）。
   * 与日志页同口径：**只有宽度真的变了才调 setter**——写入器每次都会落 `localStorage`，
   * 拖动时逐帧无条件回写等于把同一个值反复写进存储（无谓的同步 IO，也让「本机偏好」看不出何时真的变过）。
   */
  const onWidthsChange = (next: number[]): void => {
    const nextTree = next[0];
    const nextCommits = next[1];
    if (typeof nextTree === 'number' && nextTree !== treeWidth) setTreeWidth(nextTree);
    if (typeof nextCommits === 'number' && nextCommits !== commitsWidth) setCommitsWidth(nextCommits);
  };
  const hasFile = file !== '';
  const panes: ResizablePane[] = [
    {
      key: 'tree',
      label: '文件',
      width: paneWidths[0] ?? treeWidth,
      min: TREE_WIDTH.min,
      max: TREE_WIDTH.max,
      content: (
        <SnapshotTreeColumn
          // revKey 只作重挂载键：本页树固定看 HEAD，不需要随提交换版本（用户口径，见 design D3）
          revKey="HEAD"
          entries={tree.entries}
          loading={tree.loading}
          error={tree.error}
          selectedPath={hasFile ? file : undefined}
          onSelectFile={onSelectFile}
        />
      ),
      style: { padding: 8, overflow: 'auto' },
    },
    {
      key: 'commits',
      label: '提交记录',
      width: paneWidths[1] ?? commitsWidth,
      min: COMMITS_WIDTH.min,
      max: COMMITS_WIDTH.max,
      content: (
        <BlameCommitsColumn
          entries={commits.entries}
          loading={commits.loading}
          error={commits.error}
          selectedHash={hash}
          onSelect={onSelectCommit}
        />
      ),
      style: { padding: 8, overflow: 'auto' },
    },
    {
      key: 'pane',
      label: '变更内容',
      width: 0,
      min: PANE_MIN_PX,
      max: Number.MAX_SAFE_INTEGER,
      flexible: true,
      content: hasFile ? (
        <BlameChangePane
          file={file}
          hash={hash}
          view={view}
          entry={entry}
          changes={changes}
          latest={latest}
          annotate={annotate}
          selectedHash={hash === '' ? null : hash}
          affected={affected}
          {...(onViewChange === undefined ? {} : { onViewChange })}
          {...(onSelectCommit === undefined ? {} : { onSelectCommit })}
          {...(onOpenCommit === undefined ? {} : { onOpenCommit })}
          {...(onOpenDiff === undefined ? {} : { onOpenDiff })}
          {...(onShowAffected === undefined ? {} : { onShowAffected })}
          {...(onOpenInHistory === undefined ? {} : { onOpenInHistory })}
          {...(onCloseAffected === undefined ? {} : { onCloseAffected })}
          {...(onOpenAffectedFile === undefined ? {} : { onOpenAffectedFile })}
          {...(loader === undefined ? {} : { loader })}
        />
      ) : (
        <Flex align="center" justify="center" style={{ height: '100%', padding: 16 }}>
          <EmptyState title="在左侧选择一个文件，或直接输入路径" description="选中文件后这里显示它的提交与变更内容" />
        </Flex>
      ),
      style: { padding: 0 },
    },
  ];
  return (
    <ResizableColumns panes={panes} onWidthsChange={onWidthsChange} onAvailableChange={setAvailable} />
  );
}
