/** client 公共出口：HTTP 助手 + SSE 订阅 + 端点 hooks（类型来自 contracts，不持业务逻辑） */
export { getJson, postJson, putJson } from './http';
export { subscribeSse, useRepoEvents } from './events';
export type { RepoEventHandlers } from './events';
export { useRecentRepos, useOpenRepo, useRepoStatus } from './repos';
export { useLogPage, useLogStream } from './log';
export { useFileDiff, useDiffStream, useDiffPatch } from './diff';
export { useSettings } from './settings';
export { useRepoConfig, useSetConfig } from './config';
export { useAbortOperation, useOperation } from './operation';
export { useStaging, useHunkStaging } from './staging';
export { useCommit } from './commit';
export { useBranches, useBranchAction } from './branches';
export { useCheckout } from './checkout';
