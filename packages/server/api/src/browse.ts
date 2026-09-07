/**
 * browse 功能：历史快照浏览——以指定提交为根的只读文件树 + 单文件内容。
 * 对应 Java GitBrowseRepoAtRevisionAction 的 RepositoryBrowser 语义（虚拟文件，不触碰工作区）。
 *
 * 入参校验在本层收敛：rev 非提交 → INVALID_REF（verifyCommitish 预检，无效 ref 显式报错而非 git 英文原文上抛）；
 * file 路径越界 → INVALID_QUERY；file 在该版本不存在 → INVALID_REF。
 * 二进制判定：git show 输出经 utf8 解码后含 NUL 字节即视为二进制（文本文件不含 NUL，
 * 二进制含 0x00 的概率极高——v1 边界，与 diff 全文渲染的既有口径一致。
 */
import { isAbsolute } from 'node:path';
import { GitExitError, listTreeAtRevision, readFileAtRev, verifyCommitish } from '@rebased/core';
import { ServiceError, type BrowseContent, type BrowseContentQuery, type BrowseEntry, type BrowseTree } from '@rebased/contracts';

/** 路径边界预检：file 含 `..` 路径段或绝对路径即非法（blame/history 同口径；本场景文件只在版本内存在，不做 stat 存在性校验） */
function assertSafeFilePath(file: string): void {
  if (file.split(/[\\/]/).includes('..') || isAbsolute(file)) {
    throw new ServiceError('INVALID_QUERY', '非法的文件路径');
  }
}

/**
 * git show <rev>:<path> 因「该 rev 上不存在该路径」失败的判别（stderr 特征串沿 diff.ts 手法）：
 * 命中 → 上层映射 INVALID_REF；其余 128 退出（无效 rev 等）按原错误上抛（调用方错）。
 */
function isMissingPathAtRev(err: unknown): boolean {
  return (
    err instanceof GitExitError && err.exitCode === 128 && /(exists on disk, but not in|does not exist in)/.test(err.stderr)
  );
}

/** 指定版本的文件树：rev 预检为提交后调用 core，平铺条目直返（目录聚合由 UI 层负责） */
export async function getBrowseTree(repoPath: string, rev: string): Promise<BrowseTree> {
  if (!(await verifyCommitish(repoPath, rev))) {
    throw new ServiceError('INVALID_REF', `无效的 ref：${rev}`);
  }
  const entries: BrowseEntry[] = await listTreeAtRevision(repoPath, rev);
  return { rev, entries };
}

/** 指定版本的单文件内容：路径预检 → git show 读取 → NUL 二进制标记 */
export async function getBrowseContent(repoPath: string, query: BrowseContentQuery): Promise<BrowseContent> {
  assertSafeFilePath(query.file);
  let content: string;
  try {
    content = await readFileAtRev(repoPath, { file: query.file, rev: query.rev });
  } catch (err) {
    if (isMissingPathAtRev(err)) throw new ServiceError('INVALID_REF', `文件不存在于该版本：${query.file}`);
    throw err;
  }
  return { content, binary: content.includes('\0') };
}
