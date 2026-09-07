/**
 * blame 功能：单文件逐行溯源（git blame --line-porcelain 的 core 原语 → contracts 形状）。
 *
 * 入参在此校验（预检先于 git 调用）：路径越界 → INVALID_QUERY '非法的文件路径'；
 * 文件不存在（工作区 stat）→ INVALID_REF '文件不存在：…'。
 *
 * rev 可选：指定版本溯源（Annotate Revision）；责任提交的父哈希经 parentHashesOf 批量解析
 * （一次 no-walk 取全量去重 hash，供 UI 双击 diff 导航与根提交降级）。
 *
 * 日期透传（P3-C 终审裁定）：BlameLine.dateIso 为 core 已转换的 ISO 字符串——author-time epoch 秒 +
 * author-tz 时区偏移 → %aI 等价的「作者时区墙钟」偏移 ISO（无 author-tz 时回退 UTC Z）；
 * 与 history/committed/search 的 %aI 显示口径一致（ui 的 formatCommitDate 直取字符串字段，不做日期解析）。
 */
import { statSync, type Stats } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileBlame, parentHashesOf, type CoreBlameLine } from '@rebased/core';
import { ServiceError, type BlameLine } from '@rebased/contracts';

/**
 * 预检：路径边界 + 文件存在性（blame/history 共用）。
 * 边界沿用 diff.ts 的 assertValidQuery 手法——file 含 `..` 路径段或为绝对路径即非法；
 * 另加 resolve+relative 兜底：Windows 盘符相对路径（如 C:foo）能逃过 isAbsolute 检查，
 * 凡 resolve 后仍在仓库根之外的一律按越界拦截。
 * 存在性：stat 失败（缺失）或非普通文件（目录等）→ INVALID_REF——本预检只认工作区现存文件，
 * 已删除（仅存在于历史）的文件按不存在处理。
 */
export function assertValidFilePath(repoPath: string, file: string): void {
  if (file.split(/[\\/]/).includes('..') || isAbsolute(file)) {
    throw new ServiceError('INVALID_QUERY', '非法的文件路径');
  }
  const root = resolve(repoPath);
  const resolved = resolve(root, file);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ServiceError('INVALID_QUERY', '非法的文件路径');
  }
  let stat: Stats;
  try {
    stat = statSync(resolved);
  } catch {
    throw new ServiceError('INVALID_REF', `文件不存在：${file}`);
  }
  if (!stat.isFile()) {
    throw new ServiceError('INVALID_REF', `文件不存在：${file}`);
  }
}

/** core 溯源行 → contracts BlameLine（字段同构，映射在此收敛，core 不依赖 contracts）；
 *  parents 经批量解析补全（一次 no-walk 取全量去重 hash 的父提交） */
async function toBlameLine(line: CoreBlameLine, parentsByHash: Record<string, string[]>): Promise<BlameLine> {
  return {
    lineno: line.lineno,
    hash: line.hash,
    shortHash: line.shortHash,
    author: line.author,
    authorEmail: line.authorEmail,
    dateIso: line.dateIso,
    content: line.content,
    previousLineno: line.previousLineno,
    parents: parentsByHash[line.hash] ?? [],
  };
}

/** 单文件逐行溯源：预检通过后调用 core，逐行映射；文件行数不大，一次全量返回；
 *  rev 可选（指定版本溯源）；责任提交父哈希批量解析供 diff 导航（根提交 parents=[]） */
export async function getFileBlame(repoPath: string, file: string, rev?: string): Promise<BlameLine[]> {
  assertValidFilePath(repoPath, file);
  const lines = await fileBlame(repoPath, file, rev);
  const hashes = [...new Set(lines.map((l) => l.hash))];
  const parentsByHash = await parentHashesOf(repoPath, hashes);
  return Promise.all(lines.map((line) => toBlameLine(line, parentsByHash)));
}
