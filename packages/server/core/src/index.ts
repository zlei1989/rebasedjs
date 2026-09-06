/** core 公共出口：git CLI 引擎原语。testing 夹具与内部实现不进本出口。 */
export { GitExitError, getExecLog, runGit, streamGit } from './exec';
export type { ExecLogEntry } from './exec';
export { cloneGitRepo, findRepoRoot, initGitRepo } from './repo';
export { getStatus, parsePorcelainV2 } from './status';
export type { CoreChangeEntry, CoreStatus } from './status';
export { parseLogRecord, streamLog } from './log';
export type { CoreCommit, StreamLogOptions } from './log';
export { fileBlame, parseBlamePorcelain } from './blame';
export type { CoreBlameLine } from './blame';
export { fileHistory, parseHistoryRecords } from './history';
export type { CoreFileHistoryEntry } from './history';
export { committedPage } from './committed';
export type { CoreCommittedEntry } from './committed';
export { searchCommits } from './search';
export type { CoreSearchResult } from './search';
export { collectFileDiff, streamFileDiff } from './diff';
export type { FileDiffOptions } from './diff';
export { readFileAtRev } from './content';
export { getGitConfigEntries, setGitConfigLocal } from './config';
export type { CoreConfigEntry } from './config';
export { getOperationState, abortGitOperation } from './operation';
export type { CoreOperation } from './operation';
export { applyPatch, checkApplyPatch, cleanUntracked, discardPaths, stagePaths, unstagePaths } from './staging';
export { commitStaged } from './commit';
export {
  createBranch,
  deleteBranch,
  listBranches,
  mergedBranchNames,
  renameBranch,
  setBranchUpstream,
} from './branch';
export type { CoreBranch } from './branch';
export { checkoutBranch, checkoutDetached, checkoutNewBranch } from './checkout';
export { resetToRef, verifyCommitish } from './reset';
export { canContinueMerge, continueMerge, mergeBranch } from './merge';
export type { CoreMergeResult } from './merge';
export { checkoutConflictSide, deleteConflictFile, listConflictedPaths, markResolved, readStageContent } from './conflict';
export type { CoreConflict } from './conflict';
export { applyStash, dropStash, listStashes, popStash, saveStash, stashToBranch } from './stash';
export type { CoreStash } from './stash';
export { addRemote, fetchRemote, isShallowRepo, listRemotes, pullRemote, pushBranch, removeRemote, setRemoteUrl } from './remote';
export type { CoreRemote } from './remote';
export { diffRefsSnapshots, takeRefsSnapshot } from './refs';
export type { RefsSnapshot } from './refs';
export { continueRebase, listTodoCommits, rebaseOnto, runInteractiveRebase } from './rebase';
export type { CoreRebaseResult } from './rebase';
export { cherryPickCommits, continuePick, isAncestor, revertCommits } from './pick';
export type { CorePickResult } from './pick';
export { createTag, deleteTag, listTags, pushTag } from './tag';
export type { CoreTag } from './tag';
