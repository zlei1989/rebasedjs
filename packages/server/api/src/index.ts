/** api 公共出口：功能服务层（一个功能一个文件），框架层只从这里 import。 */
export { cloneRepo, getRepoById, initRepo, listRecentRepos, openRepo } from './repo';
export { getRepoStatus } from './status';
export { watchRepoStatus } from './events';
export { getRepoConfig, setRepoConfig } from './config';
export { abortOperation, getOperation } from './operation';
export { getLogPage, streamLogEvents } from './log';
export { getFileDiff, getFileVersions, streamDiffEvents } from './diff';
export { applyHunkStaging, applyStaging } from './staging';
export { createCommit } from './commit';
export { applyBranchAction, getBranches } from './branch';
export { applyCheckout } from './checkout';
export { applyReset, undoCommit } from './reset';
export { continueMergeOperation, mergeBranchIntoCurrent } from './merge';
export { getConflictContents, getConflicts, resolveConflict } from './conflict';
export { getSettings, updateSettings } from './settings';
export { toServiceError } from './errors';
