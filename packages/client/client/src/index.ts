/** client 公共出口：HTTP 助手 + SSE 订阅 + 端点 hooks（类型来自 contracts，不持业务逻辑） */
export { getJson, postJson, putJson } from './http';
export { subscribeSse, useRepoEvents } from './events';
export { useRecentRepos, useOpenRepo, useRepoStatus } from './repos';
export { useLogPage, useLogStream } from './log';
export { useFileDiff, useDiffStream } from './diff';
export { useSettings } from './settings';
