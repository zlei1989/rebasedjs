/** api 公共出口：功能服务层（一个功能一个文件），框架层只从这里 import。 */
export { cloneRepo, getRepoById, initRepo, listRecentRepos, openRepo } from './repo';
export { getRepoStatus } from './status';
export { getLogPage, streamLogEvents } from './log';
export { getFileDiff, getFileVersions, streamDiffEvents } from './diff';
export { getSettings, updateSettings } from './settings';
export { toServiceError } from './errors';
