/** core 公共出口：git CLI 引擎原语。testing 夹具与内部实现不进本出口。 */
export { GitExitError, runGit, streamGit } from './exec';
export { cloneGitRepo, findRepoRoot, initGitRepo } from './repo';
export { getStatus, parsePorcelainV2 } from './status';
export type { CoreChangeEntry, CoreStatus } from './status';
export { parseLogRecord, streamLog } from './log';
export type { CoreCommit, StreamLogOptions } from './log';
export { collectFileDiff, streamFileDiff } from './diff';
export type { FileDiffOptions } from './diff';
export { readFileAtRev } from './content';
export { getGitConfigEntries, setGitConfigLocal } from './config';
export type { CoreConfigEntry } from './config';
export { getOperationState, abortGitOperation } from './operation';
export type { CoreOperation } from './operation';
export { applyPatch, cleanUntracked, discardPaths, stagePaths, unstagePaths } from './staging';
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
export { continueMerge, mergeBranch } from './merge';
export type { CoreMergeResult } from './merge';
export { checkoutConflictSide, listConflictedPaths, markResolved, readStageContent } from './conflict';
export type { CoreConflict } from './conflict';
export { applyStash, dropStash, listStashes, popStash, saveStash, stashToBranch } from './stash';
export type { CoreStash } from './stash';
