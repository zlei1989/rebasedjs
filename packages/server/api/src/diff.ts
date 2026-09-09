/** diff 功能：单文件全文与流式事件 + 分支 vs 工作树差异，core 原语 → contracts 形状，入参在此校验。 */
import { isAbsolute } from 'node:path';
import { GitExitError, collectFileDiff, listDiffFiles, readFileAtRev, streamFileDiff, verifyCommitish } from '@rebased/core';
import { ServiceError, type BranchWorkingDiff, type CommittedFileStatus, type DiffEvent, type DiffFile, type DiffQuery, type FileThreeVersions, type FileVersions, type ThreeWayQuery } from '@rebased/contracts';

/**
 * 校验 diff 查询入参，非法即抛 INVALID_QUERY。
 * 规则：to 必须有 from（to-only 无意义）；from-only = 分支 vs 工作树（GitShowDiffWithRefAction 语义）；
 * to 无 from → INVALID_QUERY；staged 与 from/to 互斥，否则 core 会静默降级为工作区 diff。
 * 安全：file 必须为仓库内相对路径。工作区分支经 join(repoPath, file) 直读文件系统，
 * 含 `..` 路径段或绝对路径的 file 可逃逸仓库根读取任意文件（rev 分支因 git 拒绝 `..` 免疫），
 * 故在此统一拦截。
 */
function assertValidQuery(query: DiffQuery): void {
  const hasFrom = query.from !== undefined;
  const hasTo = query.to !== undefined;
  if (hasTo && !hasFrom) throw new ServiceError('INVALID_QUERY', 'diff 查询 to 必须与 from 成对提供（from-only = 分支 vs 工作树）');
  if (query.staged && (hasFrom || hasTo)) throw new ServiceError('INVALID_QUERY', 'staged 与 from/to 不能同时使用');
  if (query.file.split(/[\\/]/).includes('..') || isAbsolute(query.file)) {
    throw new ServiceError('INVALID_QUERY', 'diff 查询 file 必须是仓库内相对路径');
  }
}

export async function getFileDiff(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): Promise<DiffFile> {
  assertValidQuery(query);
  const text = await collectFileDiff(repoPath, { ...query, signal: opts.signal });
  return { path: query.file, text };
}

/** name-status 状态字母 → 契约状态（未知字母如 U/X/B 少见且非工作树差异常见形态 → 按 M 承载展示） */
const STATUS_SET: readonly CommittedFileStatus[] = ['A', 'M', 'D', 'R', 'C', 'T'];

/**
 * 分支 vs 工作树差异（GitShowDiffWithRefAction 语义：git diff <ref> — 含未提交变更）：
 * 分支有效性预检（verifyCommitish → INVALID_REF）+ `--name-status` 文件清单（R/C 带 renameFrom）。
 */
export async function getBranchWorkingDiff(repoPath: string, branch: string): Promise<BranchWorkingDiff> {
  if (!(await verifyCommitish(repoPath, branch))) {
    throw new ServiceError('INVALID_REF', `引用不存在或不是提交：${branch}`);
  }
  const files = await listDiffFiles(repoPath, branch);
  return {
    branch,
    files: files.map((f) => ({
      path: f.path,
      status: (STATUS_SET as readonly string[]).includes(f.status) ? (f.status as CommittedFileStatus) : 'M',
      ...(f.renameFrom !== undefined ? { renameFrom: f.renameFrom } : {}),
    })),
  };
}

export async function* streamDiffEvents(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): AsyncIterable<DiffEvent> {
  assertValidQuery(query);
  for await (const chunk of streamFileDiff(repoPath, { ...query, signal: opts.signal })) {
    yield { type: 'diff.chunk', payload: { text: chunk } };
  }
}

/**
 * git show <rev>:<path> 因「该 rev 上不存在该路径」失败的 stderr 判别：
 * 工作区存在同名路径 → 'path ... exists on disk, but not in <rev>'；工作区也不存在 → 'path ... does not exist in <rev>'。
 * 特征串判定沿 conflict.ts 手法；其余退出码 128（无效 rev/ambiguous 等）不匹配，按原错误上抛（调用方错）。
 */
function isMissingPathAtRev(err: unknown): boolean {
  return (
    err instanceof GitExitError && err.exitCode === 128 && /(exists on disk, but not in|does not exist in)/.test(err.stderr)
  );
}

/** from/to 定提交对比的单侧读取：该侧无此路径（新增 A / 删除 D / 重命名目标 R 均有一侧缺失）时返回 ''——
 *  与 `git diff A B -- path` 语义一致（文件仅在 B 侧 → 全新增；仅在 A 侧 → 全删除；两侧同 → 常规对比） */
async function readFileOrMissing(repoPath: string, file: string, rev: string | undefined): Promise<string> {
  try {
    return await readFileAtRev(repoPath, { file, rev });
  } catch (err) {
    if (isMissingPathAtRev(err)) return '';
    throw err;
  }
}

/** 单文件两侧全文：staged→HEAD vs 暂存区；工作区→HEAD vs 工作区；from/to→两侧版本（单侧缺失 → 空串）。 */
export async function getFileVersions(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): Promise<FileVersions> {
  assertValidQuery(query);
  if (query.from !== undefined && query.to !== undefined) {
    const [before, after] = await Promise.all([
      readFileOrMissing(repoPath, query.file, query.from),
      readFileOrMissing(repoPath, query.file, query.to),
    ]);
    return { before, after };
  }
  const before = await readFileAtRev(repoPath, { file: query.file, rev: 'HEAD' });
  const after = query.staged
    ? await readFileAtRev(repoPath, { file: query.file, rev: '' })
    : await readFileAtRev(repoPath, { file: query.file });
  return { before, after };
}

/** 三版本对比：HEAD / 暂存区（:file）/ 工作区三侧全文（GitStageCompareThreeVersionsAction 语义）；
 *  路径预检沿 assertValidQuery 的文件边界规则（越界 → INVALID_QUERY）。 */
export async function getFileThreeVersions(repoPath: string, query: ThreeWayQuery): Promise<FileThreeVersions> {
  if (query.file.split(/[\\/]/).includes('..') || isAbsolute(query.file)) {
    throw new ServiceError('INVALID_QUERY', 'diff 查询 file 必须是仓库内相对路径');
  }
  const [head, staged, working] = await Promise.all([
    readFileAtRev(repoPath, { file: query.file, rev: 'HEAD' }),
    readFileAtRev(repoPath, { file: query.file, rev: '' }),
    readFileAtRev(repoPath, { file: query.file }),
  ]);
  return { head, staged, working };
}
