/**
 * pick 原语：摘樱桃（cherry-pick）与还原（revert），支持多提交、冲突后继续与祖先判定。
 * 冲突判定同 P2-E：仅 ls-files -u 有未合并条目——只凭操作态会把「空补丁停态」误判为冲突
 * （见 hasConflicts 注释，P3-B 终审死循环根因）；其余非 0 退出原样抛 GitExitError。
 * continue 一律带 -c core.editor=true（无 TTY 编辑器防护，P2-E 教训）。
 */
import { listConflictedPaths } from './conflict';
import { GitExitError, runGit } from './exec';

export interface CorePickResult {
  status: 'success' | 'conflicts';
}

/**
 * 冲突判定：仅 ls-files -u 未合并条目非空。
 * cherry-pick/revert 存在「空补丁停态」：git 留 CHERRY_PICK_HEAD/REVERT_HEAD 但不含任何未合并
 * 条目（祖先摘樱桃、双重还原等补丁为空的情形——实测 ls-files -u 为 0）。若凭操作态归类
 * conflicts，UI 会跳冲突页、看到 0 冲突并以「继续」无限空补丁重试——死循环；
 * 空补丁因此按 GitExitError 原样透出（api 层以 isAncestor 预检在停态产生前拦下常态路径）。
 */
async function hasConflicts(cwd: string): Promise<boolean> {
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

/**
 * 摘樱桃一个或多个提交：git cherry-pick <hash>...（顺序即应用顺序，某步冲突即停）。
 * opts.keepEmpty：补丁为空的提交（原提交本身即空提交，如 `git commit --allow-empty`；
 * 或变更已在上游存在）仍保留为提交并继续后续重放。git 缺省 `--empty=stop` 会在首个空提交处中止，
 * 使「force-push 修复」半途停下并遗留 sequencer 停态（冒烟 D-22：
 * `fatal: The previous cherry-pick is now empty`，本地分支卡在重放中途）。
 * 交互式摘樱桃不传此开关：用户摘一个空补丁提交应见到错误，而非静默造出空提交。
 */
export async function cherryPickCommits(
  cwd: string,
  hashes: string[],
  opts: { keepEmpty?: boolean } = {},
): Promise<CorePickResult> {
  const keepEmptyArg = opts.keepEmpty === true ? ['--empty=keep'] : [];
  return runPick(cwd, ['cherry-pick', ...keepEmptyArg, ...hashes]);
}

/** 还原一个或多个提交：git revert <hash>...（顺序即还原顺序，某步冲突即停） */
export async function revertCommits(cwd: string, hashes: string[]): Promise<CorePickResult> {
  return runPick(cwd, ['revert', ...hashes]);
}

/**
 * 祖先判定：git merge-base --is-ancestor <hash> HEAD；退出码 0 → true，1 → false（非祖先），
 * 其余（无效 ref 等）原样抛 GitExitError。用于摘樱桃前的空补丁预检：
 * 祖先提交的补丁已在当前分支历史中，摘樱桃必为空补丁（见 hasConflicts 注释），
 * api 层在 git 创建停态之前以 INVALID_QUERY 拦下。
 */
export async function isAncestor(cwd: string, hash: string): Promise<boolean> {
  try {
    await runGit(['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd });
    return true;
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return false;
    throw e;
  }
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

/** 跳过冲突中的摘樱桃/还原：git <kind> --skip（放弃该次应用的变更，继续后续；EmptyCherryPickResolutionStrategy 语义） */
export async function skipPick(cwd: string, kind: 'cherry-pick' | 'revert'): Promise<void> {
  await runGit(['-c', 'core.editor=true', kind, '--skip'], { cwd });
}
