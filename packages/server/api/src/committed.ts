/**
 * committed 功能：Committed Changes 分页浏览（历史提交及其变更文件）。
 * 入参 query 由调用方经 committedQuerySchema 解析（limit≤200/skip 游标），本层直接透传 core。
 * 映射要点：core 以 string 透传 name-status 码（忠于 git 输出），此处窄化到契约联合
 * CommittedFileStatus（含 T——typechange，git --name-status 真实输出，P3-C 审查裁定补入）；
 * parents 为 %P 解析的父哈希数组（根提交 []），容器打开 diff 据此定 from（终审 Must-fix 2）。
 * 日期透传：dateIso 为 %aI 原样透传（带作者时区偏移的 ISO；ui 消费方 formatCommitDate 直取字符串字段）。
 */
import { commitFiles, committedPage, verifyCommitish, type CoreCommittedEntry } from '@rebased/core';
import { ServiceError, type CommittedEntry, type CommittedFileStatus, type CommittedPage, type CommittedPageQuery } from '@rebased/contracts';

/** core 提交条目 → contracts CommittedEntry（status string 窄化到联合，renameFrom 缺省时不下发 undefined 键） */
function toCommittedEntry(entry: CoreCommittedEntry): CommittedEntry {
  return {
    hash: entry.hash,
    shortHash: entry.shortHash,
    subject: entry.subject,
    author: entry.author,
    dateIso: entry.dateIso,
    parents: entry.parents,
    files: entry.files.map((f) => ({
      path: f.path,
      // git name-status 在正常提交遍历下仅产出 A/M/D/R/C/T（core 已取状态首字母，如 R100→R），此处窄化到契约联合
      status: f.status as CommittedFileStatus,
      ...(f.renameFrom !== undefined ? { renameFrom: f.renameFrom } : {}),
    })),
  };
}

/** Committed Changes 分页：hasMore 语义由 core 多取 1 试探给出，本层原样转发 */
export async function getCommittedPage(repoPath: string, query: CommittedPageQuery): Promise<CommittedPage> {
  const page = await committedPage(repoPath, { limit: query.limit, skip: query.skip });
  return { entries: page.entries.map(toCommittedEntry), hasMore: page.hasMore };
}

/**
 * 单提交变更文件（Show All Affected 语义 #34）：hash 有效性预检（verifyCommitish →
 * INVALID_REF 引用不存在或不是提交），再取全量文件清单。
 */
export async function getCommitFiles(repoPath: string, hash: string): Promise<CommittedEntry> {
  if (!(await verifyCommitish(repoPath, hash))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${hash}`);
  }
  return toCommittedEntry(await commitFiles(repoPath, hash));
}
