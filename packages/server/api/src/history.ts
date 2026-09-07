/**
 * history 功能：单文件历史（git log --follow 跟随重命名，最新在前）。
 * 入参预检与 blame 完全一致（路径越界 → INVALID_QUERY；不存在 → INVALID_REF），复用 blame.assertValidFilePath。
 * 日期透传：dateIso 为 %aI 原样透传（带时区偏移的 ISO），与 blame 的 UTC Z 同为合法 ISO 日期字符串，
 * 本层不做归一转换，消费方用 new Date() 解析（P3-C 审查裁定）。
 */
import { fileHistory, type CoreFileHistoryEntry } from '@rebased/core';
import type { FileHistoryEntry } from '@rebased/contracts';
import { assertValidFilePath } from './blame';

/** core 历史条目 → contracts FileHistoryEntry（字段同构 + parents 透传，映射在此收敛） */
function toFileHistoryEntry(entry: CoreFileHistoryEntry): FileHistoryEntry {
  return {
    hash: entry.hash,
    shortHash: entry.shortHash,
    subject: entry.subject,
    author: entry.author,
    dateIso: entry.dateIso,
    parents: entry.parents,
  };
}

/** 单文件历史：预检通过后调用 core，逐条映射 */
export async function getFileHistory(repoPath: string, file: string): Promise<FileHistoryEntry[]> {
  assertValidFilePath(repoPath, file);
  const entries = await fileHistory(repoPath, file);
  return entries.map(toFileHistoryEntry);
}
