/** diff 原语：--no-ext-diff 禁外部差异工具；P1 输出 unified diff 全文/流。 */
import { runGit, streamGit } from './exec';

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
