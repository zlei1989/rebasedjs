export { VirtualList, type VirtualListProps } from './base/virtual-list';
export { GraphCanvas, type GraphCanvasProps } from './base/graph-canvas';
export { FileTree, type FileTreeNode, type FileTreeProps } from './base/file-tree';
export { buildDirectoryTree } from './domain/directory-tree';
export {
  MonacoDiffView,
  type MonacoDiffViewProps,
  type MonacoDiffInnerProps,
  type MonacoDiffLoader,
} from './base/monaco-diff-view';
export { MonacoTextView, type MonacoTextViewProps } from './base/monaco-text-view';
export { EmptyState, type EmptyStateProps } from './base/empty-state';
export { COMPACT_FONT_TOKENS, compactTheme, type DensityMode } from './base/density';
export { OperationStatus, type OperationStatusProps } from './base/operation-status';
export * from './graph-layout';
export { CommitGraph, type CommitGraphProps } from './domain/commit-graph';
export { RepoStatusBar, type RepoStatusBarProps } from './domain/repo-status-bar';
export { DiffViewer, type DiffViewerProps } from './domain/diff-viewer';
export { HunkDiffView, type HunkDiffViewProps } from './domain/hunk-diff-view';
export { CommitDetailsPanel, type CommitDetailsPanelProps } from './domain/commit-details-panel';
export { RepoPage, type RepoPageProps, type RepoListItem } from './composite/repo-page';
export { LogPage, type LogPageProps } from './composite/log-page';
export { RepoTopNav, type RepoTopNavProps, type RepoNavPage } from './composite/repo-top-nav';
export { SnapshotTabs, type SnapshotTabsProps } from './composite/snapshot-tabs';
export { DiffPage, type DiffPageProps } from './composite/diff-page';
export {
  AppSettingsPage,
  RepoSettingsPage,
  type AppSettingsPageProps,
  type RepoSettingsPageProps,
} from './composite/settings-page';
export {
  StatusPage,
  type StatusPageProps,
  groupChanges,
  type GroupedChanges,
  groupByChangelist,
} from './composite/status-page';
export { IgnoreDialog, type IgnoreDialogProps } from './composite/ignore-dialog';
export { ConsolePanel, type ConsolePanelProps } from './composite/console-panel';
export { GitHubPanel, type GitHubPanelProps } from './composite/github-panel';
export { GitLabPanel, type GitLabPanelProps } from './composite/gitlab-panel';
export { BranchPanel, mergedCleanupCandidates, type BranchPanelProps } from './composite/branch-panel';
export { BranchCompareView, type BranchCompareViewProps } from './composite/branch-compare-view';
export { BlameView, type BlameViewProps } from './composite/blame-view';
export {
  changesHints,
  isEntryReady,
  resolveBlameHash,
  type BlameViewKey,
  type ChangesHints,
} from './composite/blame-state';
export { BlameAnnotateTable, type BlameAnnotateTableProps } from './composite/blame-annotate-table';
export { BlameChangePane, type BlameChangePaneProps, type BlameDiffChannel } from './composite/blame-change-pane';
export { BlameCommitsColumn, type BlameCommitsColumnProps } from './composite/blame-commits-column';
export { HistoryPanel, type HistoryPanelProps } from './composite/history-panel';
export {
  SnapshotTreeColumn,
  snapshotTreeNodes,
  topLevelDirKeys,
  type SnapshotTreeColumnProps,
} from './composite/snapshot-tree-column';
export { DiffStreamView, type DiffStreamViewProps } from './composite/diff-stream-view';
export { ThreeWayView, type ThreeWayViewProps } from './composite/three-way-view';
export {
  CommittedChangesPanel,
  type CommittedChangesPanelProps,
} from './composite/committed-changes-panel';
export { SearchPanel, type SearchPanelProps } from './composite/search-panel';
export { StashPanel, type StashPanelProps } from './composite/stash-panel';
export { PatchPanel, type PatchPanelProps } from './composite/patch-panel';
export { ShelfPanel, type ShelfPanelProps } from './composite/shelf-panel';
export { WorktreePanel, type WorktreePanelProps } from './composite/worktree-panel';
export { SubmodulePanel, type SubmodulePanelProps } from './composite/submodule-panel';
export { ResetDialog, type ResetDialogProps } from './composite/reset-dialog';
export { MergeDialog, type MergeDialogProps } from './composite/merge-dialog';
export { RebaseDialog, type RebaseDialogProps } from './composite/rebase-dialog';
export {
  ConflictsPanel,
  conflictKindLabel,
  continueKindLabel,
  type ConflictsPanelProps,
} from './composite/conflicts-panel';
export { TagPanel, type TagPanelProps } from './composite/tag-panel';
export { MergeView, type MergeViewProps } from './composite/merge-view';
export { RemotePanel, type RemotePanelProps } from './composite/remote-panel';
export { PushDialog, type PushDialogProps } from './composite/push-dialog';
export { PullDialog, type PullDialogProps } from './composite/pull-dialog';
export {
  UpdateProjectDialog,
  type UpdateProjectDialogProps,
} from './composite/update-project-dialog';
export { AuthDialog, type AuthDialogProps } from './composite/auth-dialog';
export type { MonacoEditorInnerProps, MonacoLazyLoader, MonacoLazyProps } from './base/monaco-lazy';
export { relativeToHome } from './composite/repo-page-utils';
export {
  AVATAR_GRADIENTS,
  avatarGradient,
  avatarInitials,
} from './composite/repo-avatar-utils';
export { RepoAvatar, type RepoAvatarProps } from './composite/repo-avatar';
export { DensityProvider, useDensityMode, type DensityProviderProps } from './base/density-context';
export {
  resolveThemeMode,
  useResolvedTheme,
  type ResolvedTheme,
  type ThemePreference,
  type UseResolvedThemeOptions,
} from './base/app-theme';
export { PageShell, type PageShellProps } from './base/page-shell';
export { Toolbar, type ToolbarProps } from './base/toolbar';
export { EllipsisText, type EllipsisTextProps } from './base/ellipsis-text';
export { SplitPane, type SplitPaneProps } from './base/split-pane';
export { ResizableColumns, type ResizableColumnsProps, type ResizablePane } from './base/resizable-columns';
export { CopyOnClick, type CopyOnClickProps } from './base/copy-on-click';
export { copyToClipboard } from './base/clipboard';
export { ReadonlyTextView, type ReadonlyTextViewProps } from './base/readonly-text-view';
export {
  CodeBlock,
  PatchCodeBlock,
  type CodeBlockProps,
  type CodeBlockLoader,
  type CodeBlockHighlighter,
} from './base/code-block';
export { decoratePatchLines, type PatchLine, type PatchLineKind } from './domain/highlight';
export { openInNewTab } from './base/open-in-new-tab';
