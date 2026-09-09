/** diff 原语：--no-ext-diff 禁外部差异工具；P1 输出 unified diff 全文/流；分支 vs 工作树文件清单。 */
import { GitExitError, runGit, streamGit } from './exec';

export interface FileDiffOptions {
  file: string;
  from?: string;
  to?: string;
  staged?: boolean;
  signal?: AbortSignal;
}

function buildDiffArgs(opts: FileDiffOptions): string[] {
  const args = ['diff', '--no-ext-diff'];
  if (opts.staged) args.push('--staged');
  else if (opts.from !== undefined && opts.to !== undefined) args.push(opts.from, opts.to);
  // 仅 from（GitShowDiffWithRefAction 语义：git diff <ref> —— 分支 vs 工作树）
  else if (opts.from !== undefined) args.push(opts.from);
  args.push('--', opts.file);
  return args;
}

/** 单文件 diff 全文（小/中体积场景） */
export async function collectFileDiff(repoPath: string, opts: FileDiffOptions): Promise<string> {
  const { stdout } = await runGit(buildDiffArgs(opts), { cwd: repoPath, signal: opts.signal });
  return stdout;
}

/** 单文件 diff 流式产出（大文件场景，框架层转 SSE） */
export async function* streamFileDiff(repoPath: string, opts: FileDiffOptions): AsyncIterable<string> {
  yield* streamGit(buildDiffArgs(opts), { cwd: repoPath, signal: opts.signal });
}

export interface CoreDiffFileEntry {
  path: string;
  status: string;
  renameFrom?: string;
}

/** unborn HEAD（空仓库）判定：git rev-parse --verify HEAD 失败（exit 128）即无提交 */
export async function isUnbornHead(cwd: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', 'HEAD'], { cwd });
    return false;
  } catch (e) {
    if (e instanceof GitExitError) return true;
    throw e;
  }
}

/**
 * 工作区全量 diff（含暂存；建补丁/搁置数据源）：born = `git diff HEAD`；
 * unborn（空仓库）——`git diff HEAD` 无对象可对比：分段拼接 `git diff --cached`（暂存 vs 空树）+ `git diff`（工作区 vs 索引）。
 */
export async function collectWorkingDiff(cwd: string, paths?: string[]): Promise<string> {
  const trailing = paths === undefined ? [] : ['--', ...paths];
  if (!(await isUnbornHead(cwd))) {
    return (await runGit(['diff', '--no-ext-diff', 'HEAD', ...trailing], { cwd })).stdout;
  }
  const cached = (await runGit(['diff', '--no-ext-diff', '--cached', ...trailing], { cwd })).stdout;
  const unstaged = (await runGit(['diff', '--no-ext-diff', ...trailing], { cwd })).stdout;
  return `${cached}${unstaged}`;
}

/**
 * 分支 vs 工作树变更文件清单（GitShowDiffWithRefAction 语义：git diff <ref> --name-status）：
 * 行格式 `STATUS\tpath`（R/C 为 `ST\told\tnew`——old 为 renameFrom）；未知状态字母原样保留（上层映射）。
 */
export async function listDiffFiles(cwd: string, ref: string): Promise<CoreDiffFileEntry[]> {
  const { stdout } = await runGit(['diff', '--no-ext-diff', '--name-status', ref], { cwd });
  const files: CoreDiffFileEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line === '') continue;
    const [status, a, b] = line.split('\t');
    if (status === undefined || a === undefined) continue;
    files.push(status.startsWith('R') || status.startsWith('C')
      ? { path: b ?? a, status: status[0] ?? status, renameFrom: a }
      : { path: a, status });
  }
  return files;
}
