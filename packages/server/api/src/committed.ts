/**
 * committed 功能：单提交变更文件清单（Show All Affected 语义 #34，日志页变更集标签的数据源）。
 * 历史：原含「已提交变更分页浏览」（getCommittedPage）——该页（CommittedChangesPanel）已撤除，
 * 分页服务随之删除；本文件保留 getCommitFiles。
 * 映射要点：core 以 string 透传 name-status 码（忠于 git 输出），此处窄化到契约联合
 * CommittedFileStatus（含 T——typechange，git --name-status 真实输出，P3-C 审查裁定补入）；
 * parents 为 %P 解析的父哈希数组（根提交 []），消费方据此定 diff 的 from 与合并提交降级。
 * 日期透传：dateIso 为 %aI 原样透传（带作者时区偏移的 ISO；ui 消费方 formatCommitDate 直取字符串字段）。
 */
import { commitFiles, verifyCommitish, type CoreCommittedEntry } from '@rebased/core';
import { ServiceError, type CommittedEntry, type CommittedFileStatus } from '@rebased/contracts';

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
