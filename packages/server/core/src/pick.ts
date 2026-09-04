/**
 * pick 原语：摘樱桃（cherry-pick）与还原（revert），支持多提交与冲突后继续。
 * 冲突判定同 P2-E：operation 原语见 cherry-pick/revert 操作态，或 ls-files -u 有未合并条目；
 * 其余非 0 退出原样抛 GitExitError。continue 一律带 -c core.editor=true（无 TTY 编辑器防护，P2-E 教训）。
 */
import { listConflictedPaths } from './conflict';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';

export interface CorePickResult {
  status: 'success' | 'conflicts';
}

/** 冲突判定：进行中的 cherry-pick/revert 操作态，或 ls-files -u 未合并条目 */
async function hasConflicts(cwd: string): Promise<boolean> {
  const op = await getOperationState(cwd);
  if (op.kind === 'cherry-pick' || op.kind === 'revert') return true;
  return (await listConflictedPaths(cwd)).length > 0;
}

/** 多提交 pick 共用体（args = 'cherry-pick <hash>...' 或 'revert <hash>...'）：
 *  非 0 退出且冲突判定成立 → 'conflicts'（状态留给调用方处理），其余非 0 退出原样透出 */
async function runPick(cwd: string, args: string[]): Promise<CorePickResult> {
  try {
    await runGit(args, { cwd });
    return { status: 'success' };
  } catch (err) {
    if (err instanceof GitExitError && (await hasConflicts(cwd))) return { status: 'conflicts' };
    throw err;
  }
}

/** 摘樱桃一个或多个提交：git cherry-pick <hash>...（顺序即应用顺序，某步冲突即停） */
export async function cherryPickCommits(cwd: string, hashes: string[]): Promise<CorePickResult> {
  return runPick(cwd, ['cherry-pick', ...hashes]);
}

/** 还原一个或多个提交：git revert <hash>...（顺序即还原顺序，某步冲突即停） */
export async function revertCommits(cwd: string, hashes: string[]): Promise<CorePickResult> {
  return runPick(cwd, ['revert', ...hashes]);
}

/**
 * 继续进行中的摘樱桃/还原：git -c core.editor=true <kind> --continue。
 * 编辑器防护：--continue 提交在无 TTY 服务端会因 "Terminal is dumb" 失败，
 * 以 -c core.editor=true 强制空编辑器（同 merge.ts continueMerge 手法）。
 * 无进行中操作由 git 报错透出（api 层预检）。
 */
export async function continuePick(cwd: string, kind: 'cherry-pick' | 'revert'): Promise<void> {
  await runGit(['-c', 'core.editor=true', kind, '--continue'], { cwd });
}
