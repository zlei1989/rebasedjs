/** client 公共出口：HTTP 助手 + SSE 订阅 + 端点 hooks（类型来自 contracts，不持业务逻辑） */
export { getJson, postJson, putJson } from './http';
export { subscribeSse, useRepoEvents } from './events';
export type { RepoEventHandlers } from './events';
export { useRecentRepos, useOpenRepo, useRepoStatus } from './repos';
export { useLogPage, useLogStream } from './log';
export { useFileDiff, useDiffStream, useDiffPatch } from './diff';
export { useBlame } from './blame';
export { useHistory } from './history';
export { useBrowseTree, useBrowseContent } from './browse';
export { useCommittedPage } from './committed';
export { useSearch } from './search';
export { useSettings } from './settings';
export { useRepoConfig, useSetConfig } from './config';
export { useAbortOperation, useContinueOperation, useOperation } from './operation';
export { useRebase, useRebaseTodo, useInteractiveRebase } from './rebase';
export { useCherryPick, useRevert } from './pick';
export { useTags, useTagAction } from './tag';
export { useStaging, useHunkStaging } from './staging';
export { useCommit } from './commit';
export { useBranches, useBranchAction } from './branches';
export { useStashes, useStashAction } from './stash';
export { useChangelists, useChangelistAction } from './changelist';
export { usePatches, useCreatePatch, useApplyPatch, useDeletePatch } from './patch';
export { useShelves, useShelfAction } from './shelf';
export { useConsole } from './console';
export { useIgnore, usePutIgnore, useAddIgnore, useIgnoreTemplates } from './ignore';
export { useCheckout } from './checkout';
export { useReset, useUndoCommit } from './reset';
export { useMerge, useContinueMerge } from './merge';
export { useConflicts, useConflictContents, useResolveConflict } from './conflicts';
export { useAccounts, useUpsertAccount, useDeleteAccount } from './auth';
export { useRemotes, useRemoteAction, useFetch, usePull, usePush } from './remote';
export { useUpdateProject } from './update';
export {
  useGithubStatus,
  useGithubPrs,
  useGithubPrDetail,
  useGithubTimeline,
  useGithubPrFiles,
  useAddGithubComment,
  useSubmitGithubReview,
  useMergeGithubPr,
  useCheckoutGithubPr,
} from './github';
export {
  useGitlabStatus,
  useGitlabMrs,
  useGitlabMrDetail,
  useGitlabTimeline,
  useGitlabMrFiles,
  useCreateGitlabMr,
  useAddGitlabComment,
  useSubmitGitlabReview,
  useMergeGitlabMr,
  useCheckoutGitlabMr,
} from './gitlab';
export { useWorktrees, useCreateWorktree, useRemoveWorktree, usePruneWorktrees } from './worktree';
export { useSubmodules, useUpdateSubmodules } from './submodule';
