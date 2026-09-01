/** core 公共出口：git CLI 引擎原语。testing 夹具与内部实现不进本出口。 */
export { GitExitError, runGit, streamGit } from './exec';
export { cloneGitRepo, findRepoRoot, initGitRepo } from './repo';
export { getStatus, parsePorcelainV2 } from './status';
export type { CoreChangeEntry, CoreStatus } from './status';
export { parseLogRecord, streamLog } from './log';
export type { CoreCommit, StreamLogOptions } from './log';
export { collectFileDiff, streamFileDiff } from './diff';
export type { FileDiffOptions } from './diff';
